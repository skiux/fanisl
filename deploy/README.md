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

```
sudo -u postgres psql <<'SQL'
CREATE ROLE fanisl LOGIN PASSWORD 'change-me';
CREATE DATABASE fanisl       OWNER fanisl;
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

冒烟自检（应打印 OK + 任务列表）：

```
sudo -u fanisl bash -c 'cd /opt/fanisl/backend && PYTHONPATH=src .venv/bin/python -c "import analyzer.main as m; print([j[0] for j in m._jobs]); m.trading_pool.close(); m.pool.close()"'
```

## 5. 前端：构建静态

```
cd /opt/fanisl/frontend
sudo -u fanisl npm ci
# 同源部署：API 走 nginx 同域代理，base 设空
sudo -u fanisl bash -c 'VITE_API_BASE= npm run build'   # 产物在 dist/
```

## 6. systemd 服务

```
sudo cp /opt/fanisl/deploy/fanisl-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fanisl-api
sudo systemctl status fanisl-api
journalctl -u fanisl-api -f          # 看日志
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

- **采集**：每 15min 抓加密行情/衍生品/情绪/链上 → 时间序列入库；每天抓催化剂。库会持续「填满」。
- **保留/压缩**：每天 compact（30 天原始分辨率，更早降日级；7 天后列存压缩）。
- **自主交易**：每 4h Claude 扫全标的找机会（≤3 持仓、≤5% 在险）；持仓由引擎按 Claude 声明的
  唤醒条件确定性盯市、触发时叫 Claude 重评；平仓后自动复盘。评测数据自此积累。

## 注意

- **务必单 worker**（service 已设 `--workers 1`）。多 worker = 重复采集 + 重复自主下单。
- `.env` 含密钥，权限收紧（`chmod 600`），不要进 git。
- TradFi（股票/商品/金属）分析依赖 Polygon/OANDA key；不填则这些标的分析为空，自主扫描会跳过。
- 改了上限/频率等配置，`systemctl restart fanisl-api` 生效。
