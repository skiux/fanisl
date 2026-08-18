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

> **每个命令块的第一行都标了在哪台机器上跑**：`# ── 在【本机】上跑 ──` / `# ── 在【服务器】上跑 ──`。
> 迁移命令天然是两头各一半，混着跑会得到"关系不存在""目录不存在"这类看起来像环境坏了、
> 其实只是跑错机器的报错。
>
> **服务器上的 psql 一律要带 `-h 127.0.0.1`**：Postgres 跑在容器里，宿主机上没有 Unix socket，
> 不带 `-h` 会报 `connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed`。

---

## 0. 前置

机器上现有 docker 与 nginx，补齐其余：

```bash
# ── 在【服务器】上跑 ──
sudo apt update
sudo apt install -y git curl python3 python3-venv python3-dev build-essential \
                    ffmpeg postgresql-client-17
```

`ffmpeg` 是提帧用的；`postgresql-client-17` 提供 `psql/pg_dump/pg_restore`（要与
库同为 17，本机是 17.10）。若 trixie 源里没有 17，加 PGDG：

```bash
# ── 在【服务器】上跑 ──
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
# ── 在【服务器】上跑 ──
sudo timedatectl set-timezone UTC
```

---

## 1. Postgres（Docker）

```bash
# ── 在【服务器】上跑 ──
sudo mkdir -p /srv/fanisl-pg
sudo docker run -d --name fanisl-pg --restart unless-stopped \
  -e POSTGRES_USER=fanisl -e POSTGRES_PASSWORD='<强口令>' -e POSTGRES_DB=fanisl \
  -v /srv/fanisl-pg:/var/lib/postgresql/data \
  -p 127.0.0.1:5432:5432 \
  timescale/timescaledb:latest-pg17
```

`-p 127.0.0.1:5432:5432` 是关键：**不要**暴露到 0.0.0.0，本地会话通过 SSH 隧道进来。

### 1.1 调参（新装就做，别等撞墙）

镜像起来是 PostgreSQL 的出厂默认值，没跑过 `timescaledb-tune`。实测本机与容器的差距：
`shared_buffers` 4 GB vs 128 MB、`maintenance_work_mem` 2 GB vs 64 MB、`effective_cache_size`
12 GB vs 4 GB、`jit` off vs on（TimescaleDB 负载下 JIT 通常是负收益）、
**`max_locks_per_transaction` 512 vs 64**。最后那项会直接卡死 §2.4 的数据导入。

```bash
# ── 在【服务器】上跑 ──
docker exec fanisl-pg timescaledb-tune --quiet --yes    # 按容器可见内存算 shared_buffers 等
docker exec fanisl-pg psql -U fanisl -d postgres \
  -c "ALTER SYSTEM SET max_locks_per_transaction = 512;"   # tune 未必覆盖，显式设
docker restart fanisl-pg && sleep 5

psql -h 127.0.0.1 -U fanisl -tAF'|' -d postgres -c \
  "SELECT name, setting FROM pg_settings WHERE name IN
   ('shared_buffers','effective_cache_size','maintenance_work_mem','work_mem',
    'max_locks_per_transaction','jit') ORDER BY name"
```

`ALTER SYSTEM` 写的是数据卷里的 `postgresql.auto.conf`，重建容器也在。

`max_locks_per_transaction` 为什么要 512：`metric_samples` 有 3945 个 chunk、每个带 3 个索引，
一条横跨全部 chunk 的语句要约 15800 把锁，而 `64 × 100 连接 = 6400` 槽不够。512 给到 51200 槽，
代价约 8 MB 共享内存。这个值不只为导入——以后任何跨 chunk 的维护都要它。

建另外两个库：

```bash
# ── 在【服务器】上跑 ──
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
# ── 在【本机】上跑 ──
# 三个库一起 dump，落 ~/fanisl-backups
/Users/enin/fanisl/deploy/backup.sh
```

体量参考：`fanisl_knowledge` 1.3 MB、`fanisl_trading` 488 KB、`fanisl` 45 MB（压缩后）。

`fanisl` 的 dump 只作留底——它含 hypertable，跨版本还原不可用（见 2.2/2.4），实际迁移走
`metric_samples.csv.gz`（约 33 MB，导出命令见 2.4）。

```bash
# ── 在【本机】上跑 ──
# 传到服务器
scp ~/fanisl-backups/fanisl_knowledge-*.dump \
    ~/fanisl-backups/fanisl_trading-*.dump  <server>:/tmp/
```

### 2.2 先对版本：TimescaleDB 跨版本不能整库还原

**这一步不能跳。** 实测：本机 timescaledb **2.27.2**，`timescale/timescaledb:latest-pg17` 起来是
**2.29.2**。两版之间内部目录表结构改过（`_timescaledb_catalog.chunk` 去掉了 `schema_name`、
`chunk_constraint` 变成了视图），用 2.29.2 `pg_restore` 2.27.2 的 dump 会报：

```
ERROR: column "schema_name" of relation "chunk" does not exist
ERROR: cannot copy to view "chunk_constraint"
```

先看服务器装的是哪个版本：

```bash
# ── 在【服务器】上跑 ──
psql -h 127.0.0.1 -U fanisl -tAc \
  "SELECT extversion FROM pg_extension WHERE extname='timescaledb'" postgres
```

版本与本机不一致时，按 2.3 / 2.4 分别处理——**不要**对含 hypertable 的库做整库 `pg_restore`。

### 2.3 恢复：knowledge / trading

`fanisl_knowledge` 不含任何扩展，直接还原，不受版本影响：

```bash
# ── 在【服务器】上跑 ──
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
# ── 在【服务器】上跑 ──
psql -h 127.0.0.1 -U fanisl -tAc "SELECT count(*) FROM accounts" fanisl_trading   # 应为 5
```

（该库其余 11 张表本来就是空的：orders / trades / trade_plans 等全为 0 行。）

### 2.4 恢复：fanisl —— 走数据导入，不走 pg_restore

`fanisl` 里唯一有份量的是 hypertable `metric_samples`：**359 万行 / 481 MB / 3945 个 chunk**；
其余表几乎是空的（collection_runs 41 行，catalyst_items / conversations / messages 全 0）。
3945 个 chunk 跨版本整库还原会真的坏掉，所以改成"让应用自己建表、我们只灌数据"，
彻底绕开目录表的版本差异。

**第一步在本机跑**，读的是 hypertable 本体而不是各个 chunk，所以产物不含任何版本相关结构：

```bash
# ── 在【本机】上跑 ──
# 注意：服务器上还没有 metric_samples，在服务器跑这条必然报 relation does not exist
psql -q -c "\copy (SELECT scope,symbol,metric,ts,value FROM metric_samples ORDER BY ts) \
  TO PROGRAM 'gzip > $HOME/fanisl-backups/metric_samples.csv.gz' CSV" fanisl

scp ~/fanisl-backups/metric_samples.csv.gz  <server>:/tmp/
```

产物约 33 MB（已于 2026-08-18 导好，行数核对 3590607 一致）。其余步骤在服务器：

**先把锁表调大，否则第 3 步必然失败。** `metric_samples` 有 **3945 个 chunk**（数据跨度
1914-01-01 ~ 2026-08-19，112 年的研究回填），每个 chunk 带 3 个索引；一条横跨全部 chunk 的
COPY 要约 `3945 × 4 ≈ 15800` 把锁，而容器默认 `max_locks_per_transaction=64`、锁表总量只有
`64 × 100 = 6400` 槽，于是报：

```
ERROR:  out of shared memory
HINT:  You might need to increase "max_locks_per_transaction".
```

这**不是内存不足**（8 GB 实例绰绰有余），锁表大小与物理内存无关。也不能靠按行切 CSV 绕开——
行数分布极不均匀：1914-1999 只有 3.4 万行却横跨 2559 个 chunk，单独灌这一段仍要上万把锁。

**照 §1.1 做过就已经解决了**；若跳过了，现在补：

```bash
# ── 在【服务器】上跑 ──
docker exec fanisl-pg psql -U fanisl -d postgres \
  -c "ALTER SYSTEM SET max_locks_per_transaction = 512;"
docker restart fanisl-pg && sleep 5
psql -h 127.0.0.1 -U fanisl -tAc "SHOW max_locks_per_transaction" postgres   # 应为 512
```

```bash
# ── 在【服务器】上跑 ──
# 1) 建空库 + 扩展
psql -h 127.0.0.1 -U fanisl -d postgres -c "CREATE DATABASE fanisl OWNER fanisl;"
psql -h 127.0.0.1 -U fanisl -d fanisl -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# 2) 建表并转成 hypertable。等价于 marketstore 的 init（见 marketstore.py:16 与 :88，全幂等），
#    这里直接写 SQL，免得本节被迫依赖 §3 的 venv 与 .env 先装好
psql -h 127.0.0.1 -U fanisl -d fanisl <<'SQL'
CREATE TABLE IF NOT EXISTS metric_samples (
    scope   TEXT NOT NULL,
    symbol  TEXT NOT NULL,
    metric  TEXT NOT NULL,
    ts      TIMESTAMPTZ NOT NULL,
    value   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (scope, symbol, metric, ts)
);
CREATE INDEX IF NOT EXISTS idx_samples_q ON metric_samples(symbol, metric, ts);
SELECT create_hypertable('metric_samples', 'ts',
       chunk_time_interval => interval '7 days', if_not_exists => TRUE);
SQL

# 3) 灌数据（TimescaleDB 会按 ts 自动分 chunk）
gunzip -c /tmp/metric_samples.csv.gz | \
  psql -h 127.0.0.1 -U fanisl -d fanisl -c "\copy metric_samples FROM STDIN CSV"

# 4) 核对
psql -h 127.0.0.1 -U fanisl -tAc "SELECT count(*) FROM metric_samples" fanisl   # 应为 3590607
psql -h 127.0.0.1 -U fanisl -tAc \
  "SELECT num_chunks FROM timescaledb_information.hypertables WHERE hypertable_name='metric_samples'" fanisl
```

第 3 步是逐行 COPY 进 hypertable，359 万行按 `ts` 重新分 chunk，**耗时数分钟**，期间没有进度输出。
`chunk_time_interval` 与本机一致取 7 天，所以 chunk 数应当接近 3945；差几个不必在意
（取决于首末 chunk 的边界落点），**以行数为准**。

COPY 是单个事务，中途失败会整体回滚，不会留下半截数据（可用 `SELECT count(*)` 确认为 0）。
若要重来仍可先清空：`psql -h 127.0.0.1 -U fanisl -c "TRUNCATE metric_samples" fanisl`；
主键是 `(scope, symbol, metric, ts)`，重复灌会撞唯一约束而不是静默翻倍。

> **知识引擎不依赖这一步。** 它有自己的 `daily_bars`（在 `fanisl_knowledge` 里，已随 2.3 还原）。
> `fanisl` 只是 collector 的 market/catalysts 两个 job 与研究/交易侧要用；想先跑通知识引擎，
> 可以先建空的 `fanisl`（第 1、2 步），把第 3 步的历史数据留到之后补。

### 2.5 验收：逐表比对行数

不要只看 "restore 没报错"。本机已用这套比对验过一遍（12 张表全部一致）：

```bash
# ── 在【服务器】上跑 ──
# 逐表数行，再与本机同一条命令的输出对照
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

研究平台要永久历史。2026-07 有过一次 365 天策略吃掉全部深回填的事故。要查的是**挂在
用户 hypertable 上的** `policy_retention`：

```bash
# ── 在【服务器】上跑 ──
psql -h 127.0.0.1 -U fanisl -tAF'|' -c \
  "SELECT job_id, proc_name, hypertable_name FROM timescaledb_information.jobs
   WHERE proc_name = 'policy_retention'" fanisl
```

**无输出 = 正常。** 有输出才 `SELECT delete_job(<id>);`。

> 不要用 `proc_name LIKE '%retention%'` 去查——它会捞到 TimescaleDB 自带的
> `policy_job_stat_history_retention`（job_id 3，`hypertable_name` 为空）。那是清理它自己
> 作业运行历史的内建管家，每个安装都有，**删掉只会让作业日志无限膨胀**，与 `metric_samples`
> 的数据毫无关系。判别方法：`hypertable_name` 为空的都是系统内建。

跑完 §3 让应用起过一次之后，`jobs` 表里应当是这样（与本机一致）：

| job_id | proc_name | hypertable_name | 说明 |
|---|---|---|---|
| 1 | `policy_telemetry` | 空 | 系统内建，保留 |
| 3 | `policy_job_stat_history_retention` | 空 | 系统内建，保留 |
| 1000 | `policy_compression` | `metric_samples` | 应用注册的压缩策略，**应当存在** |

`.env` 里 `RETENTION_DAYS` 保持 0（默认值）。代码这一侧本来就是防御性的：`retention_days=0`
时不但不注册策略，还会**主动移除**历史上注册过的（`marketstore.py:118` 的
`remove_retention_policy`）。所以这一节是复核，不是机制本身——真正要守住的是别把
`RETENTION_DAYS` 配成非 0。

另外 §2.4 用裸 SQL 建的 hypertable 没带压缩设置，这是对的：压缩策略由应用首次启动时补上
（`compress_after_days`），旧 chunk 随后在后台被压缩，不影响已灌入的数据。

### 2.7 关键帧图片（不走 git）

117 MB，`data_export/keyframes/` 在 .gitignore 里：

```bash
# ── 在【本机】上跑 ──
rsync -av --progress /Users/enin/fanisl/data_export/keyframes/ \
      <server>:/opt/fanisl/data_export/keyframes/
```

`keyframes` 表存的是相对路径，目录位置变了要在 `.env` 里设 `KEYFRAME_ROOT`，
否则读图 404、清理只删库不删文件。

---

## 3. 后端

### 3.0 服务账号与文件权限（决定了后面维护顺不顺手）

服务用独立账号跑，但**维护不该因此处处 `sudo -u fanisl`**。做法是让你自己的账号进 `fanisl` 组，
再用默认 ACL 保证两边新建的文件互相可写——之后 `git pull`、改 `.env`、跑 CLI 都不用 sudo，
只有 `systemctl` 还需要。

```bash
# ── 在【服务器】上跑 ──
sudo apt install -y acl
sudo useradd -r -m -d /opt/fanisl -s /usr/sbin/nologin fanisl
sudo git clone <repo> /opt/fanisl
sudo chown -R fanisl:fanisl /opt/fanisl

sudo usermod -aG fanisl $USER
# 现有文件 + 之后新建的都给 fanisl 组读写（d: 是继承用的默认 ACL）
sudo setfacl -R -m g:fanisl:rwX -m d:g:fanisl:rwX /opt/fanisl

newgrp fanisl      # 或退出重登，让组成员身份生效
id -nG | tr ' ' '\n' | grep -x fanisl && echo "组已生效"
```

这样两个方向都通：服务以 `fanisl` 建的文件你能改，你建的文件服务能写。

**为什么不干脆全用你自己的账号跑？** 因为摄取链会用 ffmpeg 和 yt-dlp 解析来路不明的视频，
那是有 CVE 历史的解析器。独立账号挡不住数据库（口令就在 `.env` 里），但挡得住 `~/.ssh`、
gcloud 凭据和 sudo。代价用上面的 ACL 消掉了，就没必要省这一层。

> 若你确实不在意这层隔离：把三个 `.service` 里的 `User=fanisl` 改成你自己的用户名、
> 代码放 `~/fanisl`，本节整节可跳过。是个合理选择，只是要清楚放弃的是什么。

### 3.1 装依赖

```bash
# ── 在【服务器】上跑 ──
cd /opt/fanisl/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install .
```

### 3.2 .env

```bash
# ── 在【服务器】上跑 ──
cp /opt/fanisl/deploy/.env.example /opt/fanisl/backend/.env
chmod 660 /opt/fanisl/backend/.env      # 660 而非 600：服务与你都要读写
nano /opt/fanisl/backend/.env
```

**本机的 `.env` 里有真实凭据（Claude 中转端点与 key 等），走 scp/粘贴等带外方式传，
不要进 git。** 三条连接串改成 TCP：

```
PG_CONNINFO=host=127.0.0.1 dbname=fanisl user=fanisl password=<强口令>
PG_TRADING_CONNINFO=host=127.0.0.1 dbname=fanisl_trading user=fanisl password=<强口令>
PG_KNOWLEDGE_CONNINFO=host=127.0.0.1 dbname=fanisl_knowledge user=fanisl password=<强口令>
```

#### Gemini 走哪条通道

两条二选一，由 `GCP_PROJECT` 是否为空决定（`llm.py` 的 `make_client`）：

- 填了 `GCP_PROJECT` → **Vertex / Agent Platform**，忽略 `GEMINI_API_KEY`；
- 留空 → AI Studio，读 `GEMINI_API_KEY`。

**`GCP_PROJECT` 填项目 ID**（小写串，如 `murgrottos`），不是显示名称。它直接拼进请求 URL 的
`projects/{project}/locations/global/...` 路径段；项目编号也能用，但 ID 更好认。

服务器上走 Vertex，**盘上不用放任何长期凭据**——用实例服务账号的元数据服务器签发 token。
先确认实例绑了服务账号、且 scope 含 cloud-platform：

```bash
# ── 在【服务器】上跑 ──
curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email
curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/scopes
```

该服务账号要有 Vertex AI User（这条在有项目管理员权限的地方跑，本机或 Cloud Shell 都行）：

```bash
# ── 在【本机】上跑 ──
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<上面查到的 email>" --role="roles/aiplatform.user"
```

端到端验证——能选对通道、且拿得到 token：

```bash
# ── 在【服务器】上跑 ──
cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python -c "
from analyzer.config import get_settings
from analyzer.knowledge.llm import make_client
c = make_client(get_settings())
print(type(c).__name__, 'project=', getattr(c, 'project', None))
print('token 前 12 位:', c._access_token()[:12], '…')"
```

打印出 `VertexGeminiClient` 且拿到 token 就通了。

> **scope 是最常见的坑**：实例若用默认 scope 创建，`scopes` 里可能没有
> `https://www.googleapis.com/auth/cloud-platform`，此时 token 拿得到但调 Vertex 会 403。
> 改 scope 要先停机：`gcloud compute instances set-service-account <实例> --scopes=cloud-platform`。

> **不要把开发机的 `~/.config/gcloud/application_default_credentials.json` 拷到服务器。**
> 那是你个人账号的长期 refresh token，等同凭据；元数据服务器这条路本来就不需要它。
> 代码取 token 的顺序是"ADC 文件优先，没有才走元数据服务器"（`llm.py` 的 `_fetch_token`），
> 所以服务器上只要**不放**这个文件就会自动走对。

### 3.3 冒烟自检

```bash
# ── 在【服务器】上跑 ──
cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python - <<'PY'
import analyzer.worker_collector, analyzer.runtime as rt
print("pools ok", bool(rt.pool), bool(rt.trading_pool), bool(rt.knowledge_pool))
rt.pool.close(); rt.trading_pool.close(); rt.knowledge_pool.close()
PY
```

### 3.4 systemd

```bash
# ── 在【服务器】上跑 ──
sudo cp /opt/fanisl/deploy/fanisl-collector.service /etc/systemd/system/
sudo cp /opt/fanisl/deploy/fanisl-api.service       /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fanisl-collector
journalctl -u fanisl-collector -f
```

先只起 collector，观察几天再上 api。`fanisl-trader.service` 这一阶段不需要。

> collector 是**单实例**（PG advisory lock），跑第二份会自行退出，不要配多份。

### 3.5 关于 daily job 的触发时刻

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
# ── 在【本机】上跑 ──
# 开隧道，之后本地命令都走它
ssh -N -L 5433:127.0.0.1:5432 fanisl@<server> &
```

本地 `backend/.env` 把知识库指到隧道：

```
PG_KNOWLEDGE_CONNINFO=host=127.0.0.1 port=5433 dbname=fanisl_knowledge user=fanisl password=<强口令>
```

之后本地命令原样可用：

```bash
# ── 在【本机】上跑 ──
# 经隧道打到服务器库
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
# ── 在【服务器】上跑 ──
cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python \
  -m analyzer.knowledge.backfill_transcripts @andyleegogo --since-days 7
```

跑通后按需挂 timer。

**yt-dlp 那部分（频道清单/元数据/提帧）是另一回事**：它从服务器 IP 直连 YouTube，
数据中心段比住宅 IP 更容易吃 bot 验证。预期：

- 清单/元数据：多半可用，被拦时才需要 cookies；
- **提帧：本机今天就已经被拦**（`Sign in to confirm you're not a bot`），别指望服务器更好，
  先留在本地按需跑。

`yt-dlp` 要能随时升级：`/opt/fanisl/backend/.venv/bin/pip install -U yt-dlp`。

> **cookies.txt 先不要传上去。** 里面是真实 Google 会话，等同凭据，而那条凭据至今
> 未轮换。要用先轮换。

---

## 6. API + 前端 + nginx

```bash
# ── 在【服务器】上跑 ──
cd /opt/fanisl/frontend
npm ci
VITE_API_BASE= npm run build    # 产物 dist/
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
# ── 在【服务器】上跑 ──
git -C /opt/fanisl pull
/opt/fanisl/backend/.venv/bin/pip install -e /opt/fanisl/backend   # 依赖有变时
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
# ── 在【服务器】上跑 ──
# 新建临时库跑一遍 schema，再与生产库 diff 列与索引（命令见 git 历史 e3156ef 的做法）
```

### 提取规范版本

不需要停机。`extractor_version` + `extraction_runs.status`(active/superseded) 本来就是
版本化重放机制，库里现在正是 49 个 v1 run 与 2 个 v2 run 并存。升 v3 不影响在跑的服务。

---

## 8. 备份

服务器侧用同一个 `deploy/backup.sh`，但**别用 `sudo -u fanisl crontab -e`**：`fanisl` 的 shell 是
`/usr/sbin/nologin`，cron 拿不到 shell 来执行命令，任务会静默不跑。这台机器本来就是 systemd，
用 timer 更合适——顺带还能 `systemctl list-timers` 看到下次触发时间。

```bash
# ── 在【服务器】上跑 ──
sudo tee /etc/systemd/system/fanisl-backup.service >/dev/null <<'UNIT'
[Unit]
Description=fanisl 数据库备份（三库 pg_dump，各留最近 14 份）
After=docker.service

[Service]
Type=oneshot
User=fanisl
Group=fanisl
Environment=FANISL_BACKUP_DIR=/opt/fanisl/backups
EnvironmentFile=/opt/fanisl/backend/.env.backup
ExecStart=/opt/fanisl/deploy/backup.sh
UNIT

sudo tee /etc/systemd/system/fanisl-backup.timer >/dev/null <<'UNIT'
[Unit]
Description=每日跑一次 fanisl 备份

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT

# PGPASSWORD 单独放，别塞进 unit 文件（systemctl cat 谁都看得见）
printf 'PGPASSWORD=%s\nPGHOST=127.0.0.1\nPGUSER=fanisl\n' '<强口令>' \
  > /opt/fanisl/backend/.env.backup
chmod 660 /opt/fanisl/backend/.env.backup

sudo systemctl daemon-reload
sudo systemctl enable --now fanisl-backup.timer
sudo systemctl start fanisl-backup.service     # 立刻跑一次验证
journalctl -u fanisl-backup -n 20 --no-pager
systemctl list-timers fanisl-backup            # 看下次触发时间
```

`Persistent=true` 让机器关机错过的那次在开机后补跑。`backup.sh` 默认三个库各留最近 14 份。**再往机器外放一份**（GCS bucket 最省事）：

```bash
# ── 在【服务器】上跑 ──
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
2b. `SHOW max_locks_per_transaction` = 512，`SHOW jit` = off（§1.1 调过参）
3. 12 张表行数与本机一致（§2.5）
4. `timescaledb_information.jobs` 里没有 `policy_retention`（§2.6；job 1/3 是系统内建，保留）
5. 冒烟自检打印 `pools ok True True True`（§3.2）
6. `systemctl is-active fanisl-collector` = active，且 `journalctl` 里能看到
   `prices.refresh` 的输出
7. 手动跑一次 `python -m analyzer.knowledge.daily`，`claim_scores` 有新增或
   打印"未到期"
8. 本地隧道通：`python -m analyzer.knowledge.nodes export` 能列出服务器库的待挂单元
9. `systemctl list-timers fanisl-backup` 有下次触发时间；手动 `systemctl start fanisl-backup`
   能跑出三个 dump，`pg_restore -l` 能列出内容
10. 维护命令不带 sudo 也能跑：`git -C /opt/fanisl pull`、`nano /opt/fanisl/backend/.env`
   （§3.0 的 ACL 生效了；不生效多半是没 `newgrp fanisl` 或重登）
