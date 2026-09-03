# fanisl backend

**项目主线是知识引擎**：持续学习、持续验证、持续沉淀投资知识，核心资产是知识库本身
（定位与分期见 [`../doc/knowledge-engine-design.md`](../doc/knowledge-engine-design.md)，
模块地图见 [`src/analyzer/knowledge/README.md`](src/analyzer/knowledge/README.md)）。

本 README 讲的是**承载它的后端**，另外两条线也跑在同一进程族里：
- **行情采集**（本文下半部分）——多资产时间序列，为知识引擎的验证层提供时点价格；
- **交易评测台**（`trading/`）与**量化研究**（`research/`）——见
  [`../doc/trading-eval-repositioning.md`](../doc/trading-eval-repositioning.md) 与
  [`../doc/research/research-log.md`](../doc/research/research-log.md)。

> 历史定位（对话式加密盘面助手）已归档，见 `../doc/archive/`。项目经历过四次测量对象
> 转移：Claude → 用户 → 创作者 → 知识本身。读老文档时注意它们停在哪一次。

## 运行

需要 Python 3.11+。

```bash
# 1. 装依赖（任选其一）
uv sync                      # 用 uv
# 或：python -m venv .venv && .venv/bin/pip install -e . pytest httpx

# 2. 配置 key（模板在 deploy/.env.example，字段最全）
cp ../deploy/.env.example .env

# 3. 起服务
uv run uvicorn analyzer.main:app --reload --app-dir src
# 或：PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app --reload
```

打开 http://127.0.0.1:8000/docs 看接口。

> **本机开发把门关掉**：`.env` 里设 `AUTH_ENABLED=false` 与 `AUTH_COOKIE_SECURE=false`，
> 开发体验与加这道门之前完全一致（`/docs` 直接可用、curl 不用带 cookie）。
> 服务启动第一行会打印 `[fanisl] auth=ON/OFF`，不确定时看那里。
> 登录流程本身由 `tests/test_auth.py` 在 auth=ON 下覆盖，本机关掉不影响它被验证。

## 本地开发用隔离的库

`.env` 里的 `PG_CONNINFO` 如果指着 `port=5433`——那是通到生产的 SSH 隧道——
本地服务就会拿生产库做开发：页面显示生产缓存下来的真实数字，写操作直接落在生产上。
2026-09-02 就因此在生产库里误建过一个账号。

一次性做两件事：

```bash
createdb fanisl_dev && createdb fanisl_dev_trading
```

然后把 `.env` 里这两行改成本机库（表结构不用管，各个 Store 构造时都会
`CREATE TABLE IF NOT EXISTS`，空库自己会长出来）：

```
PG_CONNINFO=dbname=fanisl_dev
PG_TRADING_CONNINFO=dbname=fanisl_dev_trading
```

之后照常 `uvicorn` 启动即可。

**`PG_KNOWLEDGE_CONNINFO` 不用改**：提取 / 归并那条流程本来就要经隧道写生产的
知识库，那是设计。守卫只卡账户与交易两个库——账户数据（`binance_cache` / `users` /
`sessions`）在 `PG_CONNINFO` 里，知识库碰不到它们。

指向远端时**拒绝启动**，不是警告——警告会随启动日志滚过去，照样把服务跑在生产上。
确实要用本地服务读生产（复现线上问题）时加 `FANISL_ALLOW_REMOTE_DB=1`。
生产服务器不受影响：那边的 conninfo 没有 `port=`，走默认 5432，判定为本机。

`python -m analyzer.auth.bootstrap` 同理，库指向远端时默认拒绝，要加 `--remote`。

## 接口

**全站需要登录**（2026-09-02 起）。会话走 cookie，未登录一律 401；免登录的只有
`/health`、`/auth/login`、`/auth/logout`。设计与运维见
[`src/analyzer/auth/README.md`](src/analyzer/auth/README.md)。

- `POST /auth/login` — `{"username": ..., "password": ...}` → 种 cookie
- `POST /chat` — `{"message": "BTC 现在怎么看？", "conversation_id": null}` →
  `{"conversation_id": 1, "reply": "..."}`。带上返回的 `conversation_id` 即可多轮对话。
- `GET /conversations` — 对话列表
- `GET /conversations/{id}/messages` — 某对话的完整消息（含工具调用）
- `GET /health` — 健康检查

## 测试

```bash
PYTHONPATH=src .venv/bin/python -m pytest    # 或：uv run pytest
```

测试不联网：data→indicators→snapshot→tool 流水线用合成数据，Claude client 被 mock。

## 结构

```
src/analyzer/
├── main.py          # FastAPI：/chat + 市场数据只读接口 + 采集器生命周期
├── agent.py         # Claude 工具循环（含 prompt caching）
├── config.py        # key / 默认值 / 指标阈值 / watchlist / 采集间隔
├── prompts.py       # 系统提示词：角色与边界
├── models.py        # pydantic 快照契约
├── auth/            # 登录与用户管理（中间件默认拒绝 + users/sessions 两张表）
├── storage.py       # PostgreSQL 对话/消息
├── marketstore.py   # PostgreSQL 时间序列/催化剂/采集日志。metric_samples 用 TimescaleDB
│                    #   hypertable，但**扩展缺失时自动退化成普通表**（无分块/压缩/retention，
│                    #   读写照常，只打一条 warning）——开发机因此不必装 timescaledb
├── db.py            # 连接池（psycopg_pool）
├── runtime.py       # 进程级单例：三个库的池 + agent/交易服务（import 时即建池）
├── flatten.py       # 模型 → 入库行（纯函数）
├── collector.py     # 采一轮 watchlist：复用工具函数 → flatten → 写库
├── scheduler.py     # 进程内后台线程调度（无新依赖、无 shell 脚本）
├── tools/           # get_market_snapshot / get_catalysts 编排 + 注册分发
├── data/            # 可插拔数据源 + 衍生品/情绪/链上/催化剂 provider
├── indicators/      # 纯函数算指标（pandas/numpy）
├── snapshot/        # 数字 → 语义标签
├── knowledge/       # **知识引擎**（L0→L1→L2→K5→K6，独立库 fanisl_knowledge）
├── trading/         # 交易评测台（独立库 fanisl_trading）
├── research/        # 量化研究 harness（H1-H22 的 prereg 与执行）
├── worker_collector.py / worker_trader.py   # 两个后台进程入口（各自 PG advisory lock 单实例）
└── ../tools/        # 运维脚本：check_db / check_sources / check_ingest / screen_node_canonicals
```

三个进程：`main.py`(API，可多 worker) / `worker_collector.py`(采集+知识引擎日维护、周报)
/ `worker_trader.py`(交易)。后两个各自单实例，靠 PG advisory lock 防呆。

加新能力（信号 / 回测 / 新闻）= 在 `tools/registry.py` 注册一个新工具，agent 不用动。

## 数据采集与持久化（时间序列）

后台调度器定时把 watchlist 全维度数据采成时间序列，供前端可视化。设计见
[`../doc/archive/2026-06-07-persistence-design.md`](../doc/archive/2026-06-07-persistence-design.md)（已归档）。
- 写：`scheduler` 定时 → `collector` 复用 `get_market_snapshot`/`get_catalysts` 取数 →
  `flatten` 摊平 → `marketstore` 入库（market 每 15min、catalysts 每天；`COLLECTOR_ENABLED=false` 可关）。
- 读（前端）：`GET /watchlist`（最新概览）、`GET /metrics?symbol=&names=&since=`（时间序列，
  `symbol=GLOBAL` 取全市场）、`GET /catalysts/stored`、`GET /collection/status`。
- 加新指标 = 在 `flatten.py` 加一行映射，采集/存储/接口都不用动。

## 数据源（可插拔）

按资产类别接不同源，自己算指标。三层：
- `data/base.py` — `MarketDataSource` 接口（`fetch_ohlcv` 必需；衍生品/`fetch_ticker` 可选）+ 共用 `ohlcv_df` / `_http.get_json` helper。
- `data/{ccxt,polygon,oanda}_source.py` — 各源实现（按 symbol 路由）。
- `data/instruments.py` — 标的登记表（symbol→源）+ `Resolver`（按 symbol 路由）。
- `data/factory.py` — 从 settings 组装所有源 → Resolver / CryptoSentiment。

**加密衍生品维度**（仅加密永续，正交于价格的信息）：
- 按 symbol 取（同一所，`MarketDataSource` 上的方法）：资金费率、未平仓量、OI-价格背离、
  多空比、**大户多空比**、**基差/期限结构**（永续溢价 + 季度年化基差）——均来自 OKX。
- 按币种 base 取（跨所，`data/derivatives.py` 的 provider，独立于 OHLCV 源）：
  - **期权情绪**（`DeribitSource`，**无需 key**）：PCR / max pain / DVOL·ATM IV / IV skew / OI 行权价堆积。
  - **爆仓数据**（`CoinalyzeSource`，免费 key，聚合多所）：填 `COINALYZE_API_KEY` 才启用。
  - 这两类由 `factory.build_crypto_sentiment` 组装成 `CryptoSentiment`，在快照工具里 best-effort 调用。
- 爆仓**热力图**（磁吸位预测）= Coinglass 付费独家，见 `../doc/data/data-gaps.md`，订阅后再接。

**情绪与注意力（Part 3）+ 链上（Part 4）**：也进 `get_market_snapshot`（仅加密）的 `sentiment` / `onchain` 块，
都挂在 `CryptoSentiment` bundle 上（`build_crypto_sentiment` 组装），best-effort：
- `sentiment`：恐惧贪婪指数（Alternative.me，无 key）✅；社交热度（LunarCrush，**API 已转付费**，暂缺）。
- `onchain`：稳定币供应 + 公链 TVL（DefiLlama，无 key）✅、BTC 网络使用度（Blockchain.info，无 key）✅。
- 高价值链上（交易所流向/MVRV/SOPR/巨鲸标签）多为付费，见 `../doc/data/data-upgrades.md`。

**事件与催化剂（Part 2，`get_catalysts` 工具）**：与价格正交、需推理的维度。独立于行情快照。
- `data/catalysts.py` — provider 抽象（解锁/宏观/事件/新闻/ETF 流）+ `Catalysts` 集合。
- `data/defillama_source.py` — 代币解锁（DefiLlama 数据集 CDN，**无需 key**）✅ 已接。
- 宏观(FRED)/事件(CoinMarketCal)/新闻(CoinDesk Data) 需免费 key，待接；ETF 流无免费源（待订阅）。
- `factory.build_catalysts` 组装 → `get_catalysts(symbol?)`。免费现状→付费升级见 `../doc/data/data-upgrades.md`。

**新增/更换数据源 3 步**（其余代码不用动）：
1. 写 `data/xxx_source.py`，继承 `MarketDataSource`，实现 `fetch_ohlcv`（合约源再实现衍生品三项）。
2. 在 `data/factory.py` 的 `sources` 字典里加一项 `"xxx": XxxSource(...)`。
3. 在 `data/instruments.py` 用 `_reg([...别名], Instrument(..., provider="xxx", ...))` 登记标的。

当前：加密=OKX(CCXT)、美股/指数/ETF/原油=Polygon、金属=OANDA。缺口见 `../doc/data/data-gaps.md`。
