# fanisl 部署指南（Debian 13）

目标：在服务器上长跑后端（API + 后台采集 + 自主交易调度）+ nginx 提供前端，让数据持续入库、
评测数据自动积累。后端是单进程多线程（采集/交易调度是 app 启动起的线程），**只能单 worker**。

约定路径：代码放 `/opt/fanisl`，运行用户 `fanisl`。

---

## 1. 系统依赖

```
sudo apt update
sudo apt install -y python3 python3-venv python3-dev build-essential git curl nginx \
                    postgresql postgresql-contrib
```

Node（构建前端，用 NodeSource 20.x）：

```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

## 2. PostgreSQL + TimescaleDB

加 Timescale 源并安装（Debian 13 / PG 17）：

```
sudo sh -c 'echo "deb https://packagecloud.io/timescale/timescaledb/debian/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/timescaledb.list'
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/timescaledb.gpg
sudo apt update
sudo apt install -y timescaledb-2-postgresql-17
sudo timescaledb-tune --quiet --yes   # 写 shared_preload_libraries 等
sudo systemctl restart postgresql
```

> 注：apt 装的 timescaledb 会把扩展库放到正确位置，**不需要** macOS Homebrew 上那个
> `timescaledb_move.sh` 手动拷库步骤。

建用户与两个库（行情库 + 交易库），并启用扩展：

默认用本地 socket + peer 认证（OS 用户 fanisl ↔ 同名 DB 角色，免密），所以建角色不必设密码：

```
sudo -u postgres psql <<'SQL'
CREATE ROLE fanisl LOGIN;
CREATE DATABASE fanisl         OWNER fanisl;
CREATE DATABASE fanisl_trading OWNER fanisl;
SQL
sudo -u postgres psql -d fanisl         -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
sudo -u postgres psql -d fanisl_trading -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
```

表结构由应用启动时自动建（marketstore / trading store 的 init）。

## 3. 应用用户与代码

```
sudo useradd -r -m -d /opt/fanisl -s /usr/sbin/nologin fanisl
sudo -u fanisl git clone <repo> /opt/fanisl   # 或 rsync 上传
```

## 4. 后端：venv + 安装 + 配置

```
cd /opt/fanisl/backend
sudo -u fanisl python3 -m venv .venv
sudo -u fanisl .venv/bin/pip install --upgrade pip
sudo -u fanisl .venv/bin/pip install .          # 依赖见 pyproject.toml
sudo -u fanisl cp ../deploy/.env.example .env
sudo -u fanisl nano .env                         # 填 ANTHROPIC_API_KEY / PG_CONNINFO / 各数据源 key
```

> 若 pip 因公司网络的 SSL 拦截报证书错（本地开发机曾遇到），加
> `--trusted-host pypi.org --trusted-host files.pythonhosted.org`。干净的 Debian 服务器一般不需要。

冒烟自检（导入三个入口 + 通到 DB，应打印 ACCOUNT_ID）：

```
sudo -u fanisl bash -c 'cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python -c "import analyzer.main, analyzer.worker_collector, analyzer.worker_trader; import analyzer.runtime as rt; print(\"ok ACCOUNT_ID=\", rt.ACCOUNT_ID); rt.pool.close(); rt.trading_pool.close()"'
```

## 5. 前端：构建静态

```
cd /opt/fanisl/frontend
sudo -u fanisl npm ci
# 同源部署：API 走 nginx 同域代理，base 设空
sudo -u fanisl bash -c 'VITE_API_BASE= npm run build'   # 产物在 dist/
```

## 6. systemd 服务（3 车道：api / collector / trader）

服务已拆成三个独立进程，共用同一 PG 协调：**api**（请求服务，可多 worker）、**collector**
（采集调度，准时不被 Claude 拖）、**trader**（自主交易，内部快盯市/慢 Claude 各一条线程）。
collector/trader 各自有 PG advisory lock 防呆，**只能各跑一份**。

```
sudo cp /opt/fanisl/deploy/fanisl-api.service       /etc/systemd/system/
sudo cp /opt/fanisl/deploy/fanisl-collector.service /etc/systemd/system/
sudo cp /opt/fanisl/deploy/fanisl-trader.service    /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fanisl-api fanisl-collector fanisl-trader
sudo systemctl status fanisl-api fanisl-collector fanisl-trader
journalctl -u fanisl-trader -f       # 看交易日志（采集看 fanisl-collector）
```

## 7. nginx 反向代理

```
sudo cp /opt/fanisl/deploy/nginx-fanisl.conf /etc/nginx/sites-available/fanisl
sudo ln -s /etc/nginx/sites-available/fanisl /etc/nginx/sites-enabled/fanisl
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

改 `server_name` 为你的域名；HTTPS 用 `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`。

## 8. 验证

- `curl -s localhost:8000/health` → `{"status":"ok",...}`
- 浏览器开站点 → 各数据页有数据；交易页能「让 Claude 评估 / 自主扫描」。
- `curl -s localhost:8000/collection/status` → 采集 runs 在更新（数据在入库）。

## 运行后会自动发生什么（无需干预）

- **collector**：每 15min 抓加密行情/衍生品/情绪/链上 → 时间序列入库；每天抓催化剂。持续「填满」。
- **保留/压缩**：TimescaleDB 原生策略——30 天后原始样本按 retention 清、7 天后 chunk 列存压缩
  （在 marketstore 初始化时设好，非定时任务）。
- **trader**：快线程每 15s 盯市（止损/止盈/强平/限价撮合）；慢线程每 4h Claude 扫全标的找机会
  （≤3 持仓、≤5% 在险）、并按 Claude 声明的唤醒条件触发时重评；平仓后自动复盘。两条线程互不阻塞。

## 注意

- **api 现在可多 worker**（拆分后不再起后台调度）；**collector / trader 各只能一份**
  （advisory lock 会拦住第二个，但也别在 systemd 里配多份）。
- `.env` 含密钥，权限收紧（`chmod 600`），不要进 git。
- TradFi（股票/商品/金属）分析依赖 Polygon/OANDA key；不填则这些标的分析为空，自主扫描会跳过。
- 改了配置（上限/频率/key）：`systemctl restart fanisl-api fanisl-collector fanisl-trader`。
- **迁移现有部署**：拉新代码后，先 `daemon-reload` 装好三个单元，再
  `systemctl stop fanisl-api`（旧的单进程版）→ enable 新三件套。旧 API 一停，后台调度即随之停。

## 交易评测升级（多账户 / 全仓，2026-06）

代码升级后，交易评测从单账户改为**多账户对照实验**，每户 1000 USDT、全仓(cross)：
- `main`（A·自然，保留拒绝权）、`forced`（B·强制交易）、`main_shadow`（影子，机械镜像 main、不被 Claude 管理）。
- 账户在 `config.trading_accounts` 配置；启动时自动建好。`ensure_account` 只对**没交易过**的空账户采用新条款，
  **绝不改动已在跑的账户**——所以老部署里已有交易的 `main` 会保留它原来的逐仓/余额，
  新账户 `forced`/`main_shadow` 才是 cross/1000。想让 main 也走新条款：先清空它的交易（或换个账户名）。
- trader 现在**对所有账户盯市**、对被管理账户（main/forced）各跑一遍 manage/scan——
  **Claude 调用量随被管理账户数成倍增加**（2 个 ≈ 2×）。要省成本就减少 managed 账户或关掉 forced。
- 接口都加了 `?account=<name>`（默认 main）；`/trading/accounts` 列全部账户；
  `/trading/trades/{id}/cancel` 撤限价挂单。前端交易页顶部可切账户。

确定性裁决全部下沉引擎（仓位/同向/在险上限、事件邻近风险打折、TP 可达性、失效价执行、限价单 TTL、
复评宽限/冷却/一次性）——相关阈值见 `config.py` 的 `trading_*`。
