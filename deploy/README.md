# fanisl 部署指南（GCE 新加坡 / Debian 13）

目标：把持续运转的那半条流水线搬到服务器，让摄取、评分、节点重算不再受本机休眠、
网络与限额影响；提取（L1）在拿到 Claude API 之前仍由本地会话完成，通过 SSH 隧道
写同一个库。

**形态决策**

| 组件 | 方式 | 理由 |
|---|---|---|
| PostgreSQL 17 + TimescaleDB | **Docker** | Debian 13(trixie) 上 PG17 + timescale 的 apt 源要自己拼，官方镜像一步到位；数据落宿主卷，升级不动数据 |
| 后端（api / collector） | **原生 venv + systemd** | 开发还在持续，`git pull` + 重启是秒级；尤其 **yt-dlp 需要频繁升级**（YouTube 一改就得跟），镜像重建是纯摩擦 |
| 前端 | nginx 提供静态 | 已有构建产物 `frontend/dist` |

约定：代码 `/opt/fanisl`，运行用户 `fanisl`，Postgres 只监听 `127.0.0.1`。

---

## 0. 前置

机器上现有 docker 与 nginx，补齐其余：

```bash
sudo apt update
sudo apt install -y git curl python3 python3-venv python3-dev build-essential \
                    ffmpeg postgresql-client-17
```

`ffmpeg` 是提帧用的；`postgresql-client-17` 提供 `psql/pg_dump/pg_restore`（要与
库同为 17，本机是 17.10）。若 trixie 源里没有 17，加 PGDG：

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
     https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-client-17
```

时区设成 UTC，日志和调度都少一层换算：

```bash
sudo timedatectl set-timezone UTC
```

---

## 1. Postgres（Docker）

```bash
sudo mkdir -p /srv/fanisl-pg
sudo docker run -d --name fanisl-pg --restart unless-stopped \
  -e POSTGRES_USER=fanisl -e POSTGRES_PASSWORD='<强口令>' -e POSTGRES_DB=fanisl \
  -v /srv/fanisl-pg:/var/lib/postgresql/data \
  -p 127.0.0.1:5432:5432 \
  timescale/timescaledb:latest-pg17
```

`-p 127.0.0.1:5432:5432` 是关键：**不要**暴露到 0.0.0.0，本地会话通过 SSH 隧道进来。

建另外两个库：

```bash
export PGPASSWORD='<强口令>'
psql -h 127.0.0.1 -U fanisl -d fanisl -c "CREATE DATABASE fanisl_trading OWNER fanisl;"
psql -h 127.0.0.1 -U fanisl -d fanisl -c "CREATE DATABASE fanisl_knowledge OWNER fanisl;"
```

> **三个库都必须存在。** `analyzer.runtime` 在 import 时就打开全部三个连接池
> （`pool` / `trading_pool` / `knowledge_pool`），少一个 collector 起不来——哪怕你
> 这一阶段只关心知识引擎。

---

## 2. 数据迁移

### 2.1 本机导出

```bash
/Users/enin/fanisl/deploy/backup.sh          # 三个库一起，落 ~/fanisl-backups
```

体量参考：`fanisl_knowledge` 1.3 MB、`fanisl_trading` 488 KB、`fanisl` 45 MB（压缩后）。

`fanisl` 的 dump 只作留底——它含 hypertable，跨版本还原不可用（见 2.2/2.4），实际迁移走
`metric_samples.csv.gz`（约 33 MB，导出命令见 2.4）。

```bash
scp ~/fanisl-backups/fanisl_knowledge-*.dump \
    ~/fanisl-backups/fanisl_trading-*.dump \
    ~/fanisl-backups/fanisl-*.dump  <server>:/tmp/
```

### 2.2 先对版本：TimescaleDB 跨版本不能整库还原

**这一步不能跳。** 本机是 timescaledb **2.27.2**；`timescale/timescaledb:latest-pg17` 通常更新，
而它的内部目录表结构改过（`_timescaledb_catalog.chunk` 去掉了 `schema_name`、`chunk_constraint`
变成了视图）。用新版服务器 `pg_restore` 旧版 dump，会报：

```
ERROR: column "schema_name" of relation "chunk" does not exist
ERROR: cannot copy to view "chunk_constraint"
```

先看服务器装的是哪个版本：

```bash
psql -h 127.0.0.1 -U fanisl -tAc \
  "SELECT extversion FROM pg_extension WHERE extname='timescaledb'" postgres
```

版本与本机不一致时，按 2.3 / 2.4 分别处理——**不要**对含 hypertable 的库做整库 `pg_restore`。

### 2.3 恢复：knowledge / trading

`fanisl_knowledge` 不含任何扩展，直接还原，不受版本影响：

```bash
pg_restore -h 127.0.0.1 -U fanisl -d fanisl_knowledge --no-owner --no-privileges \
           /tmp/fanisl_knowledge-*.dump
```

`fanisl_trading` **装了 timescaledb 但零个 hypertable**（扩展是应用初始化时建的，实际没用上）。
跨版本还原时会在空的目录表上报 3 条错误：

```
_timescaledb_catalog.chunk / chunk_constraint / chunk_constraint_name
pg_restore: warning: errors ignored on restore: 3
```

**这 3 条可以忽略**——它们全落在空的 TimescaleDB 目录表上，没有业务数据。核对一下即可：

```bash
psql -h 127.0.0.1 -U fanisl -tAc "SELECT count(*) FROM accounts" fanisl_trading   # 应为 5
```

（该库其余 11 张表本来就是空的：orders / trades / trade_plans 等全为 0 行。）

### 2.4 恢复：fanisl —— 走数据导入，不走 pg_restore

`fanisl` 里唯一有份量的是 hypertable `metric_samples`：**359 万行 / 481 MB / 3945 个 chunk**；
其余表几乎是空的（collection_runs 41 行，catalyst_items / conversations / messages 全 0）。
3945 个 chunk 跨版本整库还原会真的坏掉，所以改成"让应用自己建表、我们只灌数据"，
彻底绕开目录表的版本差异。

本机导出（读的是 hypertable 本体，不是各个 chunk）：

```bash
psql -q -c "\copy (SELECT scope,symbol,metric,ts,value FROM metric_samples ORDER BY ts) \
  TO PROGRAM 'gzip > $HOME/fanisl-backups/metric_samples.csv.gz' CSV" fanisl
```

产物约 33 MB。传上去后：

```bash
# 1) 建空库 + 扩展
psql -h 127.0.0.1 -U fanisl -d postgres -c "CREATE DATABASE fanisl OWNER fanisl;"
psql -h 127.0.0.1 -U fanisl -d fanisl -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# 2) 让应用建表并转成 hypertable（marketstore 的 init 幂等，见 marketstore.py:90）
sudo -u fanisl bash -c 'cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python -c "
import analyzer.runtime as rt; print(\"schema ok\"); rt.pool.close(); rt.trading_pool.close(); rt.knowledge_pool.close()"'

# 3) 灌数据（TimescaleDB 会按 ts 自动分 chunk）
gunzip -c /tmp/metric_samples.csv.gz | \
  psql -h 127.0.0.1 -U fanisl -d fanisl -c "\copy metric_samples FROM STDIN CSV"

# 4) 核对
psql -h 127.0.0.1 -U fanisl -tAc "SELECT count(*) FROM metric_samples" fanisl   # 应为 3590607
```

> **知识引擎不依赖这一步。** 它有自己的 `daily_bars`（在 `fanisl_knowledge` 里，已随 2.3 还原）。
> `fanisl` 只是 collector 的 market/catalysts 两个 job 与研究/交易侧要用；想先跑通知识引擎，
> 可以先建空的 `fanisl`（第 1、2 步），把第 3 步的历史数据留到之后补。

### 2.5 验收：逐表比对行数

不要只看 "restore 没报错"。本机已用这套比对验过一遍（12 张表全部一致）：

```bash
for t in contents extraction_runs knowledge_units claim_scores knowledge_nodes \
         node_attestations node_relations keyframes spot_checks daily_bars \
         eps_estimates creators; do
  printf "%-20s %s\n" "$t" \
    "$(psql -h 127.0.0.1 -U fanisl -tAc "SELECT count(*) FROM $t" fanisl_knowledge)"
done
```

对照本机同一条命令的输出。参考值（2026-08-18，Andy 往前回填 10 期之后）：
contents 64、extraction_runs 61、knowledge_units 1012、claim_scores 288、
knowledge_nodes 556、node_attestations 635、node_relations 78、keyframes 722、
spot_checks 48、eps_estimates 26、creators 3、daily_bars 9996。

> keyframes 停在 722 是因为 YouTube 的 SABR 墙当前立着，回填这 10 期一帧都没抓到；
> 墙落下后 `daily` 的补帧环节会自动追上，届时该数字会涨。

### 2.6 retention 必须保持关闭

研究平台要永久历史。2026-07 有过一次 365 天策略吃掉全部深回填的事故：

```bash
psql -h 127.0.0.1 -U fanisl -tAc \
  "SELECT job_id, proc_name, hypertable_name FROM timescaledb_information.jobs
   WHERE proc_name LIKE '%retention%'" fanisl
```

有输出就 `SELECT delete_job(<id>);` 删掉。`.env` 里对应开关保持 0。

### 2.7 关键帧图片（不走 git）

117 MB，`data_export/keyframes/` 在 .gitignore 里：

```bash
rsync -av --progress /Users/enin/fanisl/data_export/keyframes/ \
      <server>:/opt/fanisl/data_export/keyframes/
```

`keyframes` 表存的是相对路径，目录位置变了要在 `.env` 里设 `KEYFRAME_ROOT`，
否则读图 404、清理只删库不删文件。

---

## 3. 后端

```bash
sudo useradd -r -m -d /opt/fanisl -s /usr/sbin/nologin fanisl
sudo -u fanisl git clone <repo> /opt/fanisl
cd /opt/fanisl/backend
sudo -u fanisl python3 -m venv .venv
sudo -u fanisl .venv/bin/pip install --upgrade pip
sudo -u fanisl .venv/bin/pip install .
```

### 3.1 .env

```bash
sudo -u fanisl cp /opt/fanisl/deploy/.env.example /opt/fanisl/backend/.env
sudo -u fanisl chmod 600 /opt/fanisl/backend/.env
sudo -u fanisl nano /opt/fanisl/backend/.env
```

**本机的 `.env` 里有真实凭据（Claude 中转端点与 key 等），走 scp/粘贴等带外方式传，
不要进 git。** 三条连接串改成 TCP：

```
PG_CONNINFO=host=127.0.0.1 dbname=fanisl user=fanisl password=<强口令>
PG_TRADING_CONNINFO=host=127.0.0.1 dbname=fanisl_trading user=fanisl password=<强口令>
PG_KNOWLEDGE_CONNINFO=host=127.0.0.1 dbname=fanisl_knowledge user=fanisl password=<强口令>
```

**Gemini 在 GCE 上优先走 ADC**：给实例绑一个有 Vertex AI User 角色的服务账号，
`.env` 里只填 `GCP_PROJECT=<项目号>`、留空 `GEMINI_API_KEY`，就不用在服务器上放任何
密钥。（这条通道本来就是为了绕开 AI Studio 项目被封生成权限而加的。）

### 3.2 冒烟自检

```bash
sudo -u fanisl bash -c 'cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python -c "
import analyzer.worker_collector, analyzer.runtime as rt
print(\"pools ok\", bool(rt.pool), bool(rt.trading_pool), bool(rt.knowledge_pool))
rt.pool.close(); rt.trading_pool.close(); rt.knowledge_pool.close()"'
```

### 3.3 systemd

```bash
sudo cp /opt/fanisl/deploy/fanisl-collector.service /etc/systemd/system/
sudo cp /opt/fanisl/deploy/fanisl-api.service       /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fanisl-collector
journalctl -u fanisl-collector -f
```

先只起 collector，观察几天再上 api。`fanisl-trader.service` 这一阶段不需要。

> collector 是**单实例**（PG advisory lock），跑第二份会自行退出，不要配多份。

### 3.4 关于 daily job 的触发时刻

`Scheduler` 用墙钟 + 固定 interval，相位取决于**进程启动时间**，且每次重启会立刻
补跑一次（幂等，不会重复评分）。美股收盘是 20:00 UTC，想让当天的收盘价当晚就入库，
就在 20:30 UTC 之后启动一次 collector，之后相位就固定了。

要严格定时就改用 timer：把 `KNOWLEDGE_DAILY_INTERVAL_S` 设成一个很大的值让内置 job
形同停用，另配

```
# /etc/systemd/system/fanisl-knowledge-daily.timer  → OnCalendar=*-*-* 21:00:00 UTC
# 对应 .service 执行：PYTHONPATH=src .venv/bin/python -m analyzer.knowledge.daily
```

简单起见先用内置的，够用。

---

## 4. 本地会话接服务器库（拿到 Claude API 之前的主工作流）

提取、归并、关系边、抽查仍在本地会话完成。**服务器库是唯一的真库，本地不要再留第二份**
（双写没有合并故事，一分叉就没救）。

```bash
ssh -N -L 5433:127.0.0.1:5432 fanisl@<server> &
```

本地 `backend/.env` 把知识库指到隧道：

```
PG_KNOWLEDGE_CONNINFO=host=127.0.0.1 port=5433 dbname=fanisl_knowledge user=fanisl password=<强口令>
```

之后本地命令原样可用：

```bash
python -m analyzer.knowledge.nodes export                 # 列未挂单元
python -m analyzer.knowledge.import_units <file> --dry-run
python -m analyzer.knowledge.nodes import <file>
python -m analyzer.knowledge.nodes seed-singletons        # 默认只预览
python -m analyzer.knowledge.nodes seed-singletons --commit
```

`data_export/knowledge_units/*.json` 继续留在 repo 里——它们不是数据库的替代，是
"人参与那一步"的凭据与重放日志（本机核对过：51 个文件 ↔ 51 个 run，一一对应）。

本地测试仍打本地 `fanisl_test`，与服务器无关。

---

## 5. 转录搬上服务器

这是收益最大的一步：L0 是最贵也最不可再生的资产（每期一次 Gemini 整片调用，视频删了
就没了），而 `llm.py` 走 **Gemini URL 直读**——视频由 Gemini 自己取，与服务器 IP 无关。

```bash
sudo -u fanisl bash -c 'cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python \
  -m analyzer.knowledge.backfill_transcripts @andyleegogo --since-days 7'
```

跑通后按需挂 timer。

**yt-dlp 那部分（频道清单/元数据/提帧）是另一回事**：它从服务器 IP 直连 YouTube，
数据中心段比住宅 IP 更容易吃 bot 验证。预期：

- 清单/元数据：多半可用，被拦时才需要 cookies；
- **提帧：本机今天就已经被拦**（`Sign in to confirm you're not a bot`），别指望服务器更好，
  先留在本地按需跑。

`yt-dlp` 要能随时升级：`sudo -u fanisl /opt/fanisl/backend/.venv/bin/pip install -U yt-dlp`。

> **cookies.txt 先不要传上去。** 里面是真实 Google 会话，等同凭据，而那条凭据至今
> 未轮换。要用先轮换。

---

## 6. API + 前端 + nginx

```bash
cd /opt/fanisl/frontend
sudo -u fanisl npm ci
sudo -u fanisl bash -c 'VITE_API_BASE= npm run build'    # 产物 dist/
sudo systemctl enable --now fanisl-api

sudo cp /opt/fanisl/deploy/nginx-fanisl.conf /etc/nginx/sites-available/fanisl
sudo ln -sf /etc/nginx/sites-available/fanisl /etc/nginx/sites-enabled/fanisl
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

改 `server_name`；HTTPS：`sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx`。
GCE 防火墙放行 80/443，**不要**放行 5432。

Node 20：`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs`

---

## 7. 持续更新

### 代码

```bash
sudo -u fanisl git -C /opt/fanisl pull
sudo -u fanisl /opt/fanisl/backend/.venv/bin/pip install -e /opt/fanisl/backend  # 依赖有变时
sudo systemctl restart fanisl-collector fanisl-api
```

### schema —— 唯一真正的坑

建表全靠 31 处 `CREATE TABLE IF NOT EXISTS`，**对已存在的表是整块跳过的，新加的列不会
自动生效**。本机已用"从零建库 vs 活库"逐列逐索引 diff 核对过，当前两侧完全一致、没有
欠账；但纪律必须立住：

> 以后每加一列，同时在该模块的 `_SCHEMA` 串里补一行
> `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>;`

目前只有 `extraction_runs.status` 有这行。漏了的表现是服务器静默跑在旧 schema 上，
要等某个查询才炸。部署后可随时复核：

```bash
# 新建临时库跑一遍 schema，再与生产库 diff 列与索引（命令见 git 历史 e3156ef 的做法）
```

### 提取规范版本

不需要停机。`extractor_version` + `extraction_runs.status`(active/superseded) 本来就是
版本化重放机制，库里现在正是 49 个 v1 run 与 2 个 v2 run 并存。升 v3 不影响在跑的服务。

---

## 8. 备份

服务器侧用同一个脚本：

```bash
sudo -u fanisl crontab -e
# 30 4 * * *  PGPASSWORD='<强口令>' FANISL_BACKUP_DIR=/opt/fanisl/backups \
#             /opt/fanisl/deploy/backup.sh >> /opt/fanisl/backups/backup.log 2>&1
```

`backup.sh` 默认三个库各留最近 14 份。**再往机器外放一份**（GCS bucket 最省事）：

```bash
gsutil rsync -r /opt/fanisl/backups gs://<bucket>/fanisl-backups
```

搬迁完成后本机那条 launchd（`com.fanisl.backup`）可以停掉：
`launchctl bootout gui/$(id -u)/com.fanisl.backup`。

---

## 9. 新加坡这个位置带来的变化

- **Binance**：本机长期 451 地域封锁，collector 的 `market` job 每 15 分钟失败一次。
  SG 通常不在封锁名单，这个 job 可能自己就好了——起来后看 `journalctl` 确认。
- **YouTube**：数据中心 IP 对 bot 验证更敏感，见第 5 节。
- **yfinance / FRED**：无地域问题。

---

## 10. 验收清单

按顺序确认，每条都有可执行的判据：

1. `docker ps` 里 `fanisl-pg` 是 `Up`，且 `ss -lntp | grep 5432` 只绑 127.0.0.1
2. 三个库都在：`psql -h 127.0.0.1 -U fanisl -l | grep fanisl`
3. 12 张表行数与本机一致（§2.5）
4. `timescaledb_information.jobs` 里没有 retention（§2.6）
5. 冒烟自检打印 `pools ok True True True`（§3.2）
6. `systemctl is-active fanisl-collector` = active，且 `journalctl` 里能看到
   `prices.refresh` 的输出
7. 手动跑一次 `python -m analyzer.knowledge.daily`，`claim_scores` 有新增或
   打印"未到期"
8. 本地隧道通：`python -m analyzer.knowledge.nodes export` 能列出服务器库的待挂单元
9. `deploy/backup.sh` 在服务器上能跑出三个 dump，且 `pg_restore -l` 能列出内容
