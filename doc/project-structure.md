# fanisl 项目结构（详解）

更新于 2026-06-11。fanisl = Claude 辅助的加密/TradFi 交易分析 + **交易评测台**。
核心理念：**先把数据做对**。后端 FastAPI（拆成 3 进程）+ React/TS 前端 + PostgreSQL/TimescaleDB。

```
fanisl/
├── backend/      Python 后端（FastAPI + 数据管道 + 交易评测台）
├── frontend/     React + TS + Vite 前端
├── deploy/       systemd 单元 + nginx + .env 模板 + 部署指南
└── doc/          设计/数据文档
```

---

## 后端 `backend/src/analyzer/`

### 进程入口（3 车道，见 deploy/README）
- `main.py` — FastAPI app，**只服务请求**（不起后台调度），可多 worker。所有 HTTP 路由。
- `worker_collector.py` — 采集进程（market 15min / catalysts 每天）。单实例。
- `worker_trader.py` — 交易进程：快线程盯市(15s) + 慢线程 Claude 决策(管理/扫描)。单实例。
- `worker_base.py` — worker 公共设施：PG advisory lock 单实例守卫 + 信号驱动运行。
- `backfill.py` — 一次性历史回填（`python -m analyzer.backfill`）。
- `migrate_sqlite.py` — 旧 SQLite → PG 一次性迁移。

### 组合根 / 配置
- `runtime.py` — **共享对象装配**（pool/store/resolver/agent/trading_service/ACCOUNT_ID）。
  三个入口都 import 它，各进程各建一份。
- `config.py` — 集中配置（pydantic-settings）：API key、阈值、交易参数、采集/扫描节奏。

### 数据层 `data/`（抽象 + 多源，加/换源只碰这里 + factory）
- `base.py` — `MarketDataSource` 接口（OHLCV/ticker/衍生品/盘口）。
- `derivatives.py` / `catalysts.py` / `onchain.py` — 各类 Provider 接口 + 聚合 bundle。
- `ccxt_source.py` — 加密永续（默认 **Binance**；funding/OI/LSR/taker/盘口 + 历史端点）。
- `polygon_source.py`(美股/指数/ETF/原油) · `oanda_source.py`(金属) — TradFi 分析源。
- `deribit_source.py`(期权) · `coinalyze_source.py`(爆仓) · `alternativeme_source.py`(恐惧贪婪)。
- `defillama_source.py`(解锁/稳定币/TVL) · `blockchaininfo_source.py`(BTC 网络) · `fred_source.py`(宏观)。
- 新闻：`cryptocompare_/newsapi_/finnhub_/benzinga_source.py` + `news_aggregate.py`(聚合去重)。
- `lunarcrush_source.py`(社交，付费墙未启用)。
- `instruments.py` — 标的登记 + Resolver（按符号路由；**分析源 vs 执行源拆分**：TradFi 分析走
  Polygon/OANDA、执行走 Binance 永续）。
- `factory.py` — 把 settings 组装成 resolver / sentiment bundle / catalysts bundle。
- `_http.py` — 统一 HTTP（超时/错误）。

### 数据管道（取数 → 算 → 摊平 → 入库）
- `tools/market.py` — `get_market_snapshot`：路由 → 取 OHLCV/衍生品/盘口/链上 → 组装 MarketSnapshot。
- `tools/catalysts.py` / `tools/history.py` — `get_catalysts` / `get_metric_history`（Claude 工具）。
- `tools/registry.py` — 给 Claude 的工具 JSON schema + 分发；metric 词汇由 `metrics` 自动生成。
- `indicators/compute.py` — 技术指标：`compute_indicators`(快照取末值) + **`indicator_series`(整条序列，
  回填/快照单一定义)**。
- `snapshot/builder.py` — 原始数 → 语义化 TimeframeView/Derivatives（阈值化标签）。
- `analytics.py` — 时间序列摘要（时长加权的均值/分位/轨迹）。
- `flatten.py` — MarketSnapshot → 入库行（**模型→metric 名的唯一映射**，逐周期用登记表）。
- `metrics.py` — **metric 名 + 元信息的 SSOT**（登记表）。`catalog()` 给前端，`metric_vocab()` 给工具。
- `validate.py` — 入库前取值校验（挡 NaN/越界）。

### 存储
- `db.py` — psycopg3 连接池。
- `marketstore.py` — 时间序列（`metric_samples` TimescaleDB hypertable）+ 催化剂（`catalyst_items`）
  + 采集日志。写入：`write_changed`(前向去重) / `write_history`(回填) / coverage 查询。
- `storage.py` — 对话 + 消息（`conversations`/`messages`）。
- 两个库：**`fanisl`**（行情时序 + 对话）、**`fanisl_trading`**（交易评测台）。

### 采集 / 调度
- `collector.py` — 复用 get_market_snapshot/catalysts + flatten 入库（best-effort）。
- `scheduler.py` — 极简后台定时调度（单线程，多个 Scheduler 实例分车道）。

### 对话 Agent
- `agent.py` — Claude 多轮工具循环（prompt caching + adaptive thinking）。
- `prompts.py` — 系统提示词（盘面读法 + 交易角色 + 进场/管理/复盘/扫描各阶段）。
- `models.py` — 全部 pydantic 模型（快照/衍生品/情绪/链上/催化剂/工具输入）。

### 交易评测台 `trading/`
- `models.py` — Claude 结构化产出：TradePlan（含 wake_conditions）/ Adjustment / Review / ScanResult / Decline。
- `trade_agent.py` — 进场/管理/复盘/扫描 四类结构化调用（终结工具强制收尾）。
- `engine.py` — 确定性引擎：撮合/止损止盈/强平/加减仓/盯市快照/唤醒条件监测/结果结算。
- `calc.py` — 仓位/保证金/盈亏/强平价 纯算。
- `service.py` — 编排：open_trade / mark / manage_and_review / scan / open_positions。
- `store.py` — 交易库 10 张表（accounts/trades/trade_plans/decision_inputs/orders/
  position_snapshots/trade_events/trade_results/trade_reviews/declines）。详见 [trader-data.md](trader-data.md)。

### 测试 `backend/tests/`
pytest（用 `fanisl_test` 库）：数据/快照/分析/校验/回填/metrics 一致性/交易引擎与服务等。

---

## 前端 `frontend/src/`

React + TS + Vite + Tailwind；Geist 字体、Phosphor 图标、zinc+emerald 调色、recharts。

- `App.tsx` — 外壳 + 顶部标签导航（对话 + 各数据页 + 交易）。
- `main.tsx` / `index.css` / `styles/` — 入口与样式。
- `api.ts` — 后端 API 封装（`VITE_API_BASE` 控制基址）。`types.ts` — 类型。
- `components/` — `ChatView`/`Composer`/`MessageList`/`MarkdownRenderer`(Prism 高亮)/`Sidebar`/`PriceTicker`。
- `useConversations.ts` — 对话状态。
- `market/`：
  - `ui.tsx` — 共享展示组件（Panel/Kpi/Badge/EmptyState/PageShell…）。PageShell 页头固定、内容区独立滚动（body 不滚）。
  - `format.ts` — 数值/时间格式化。`trading.ts` — 交易评测领域标签映射 + 格式化。`useMarketData.ts` — 数据拉取 hook。
  - `pages/` — `DataExplorer`(数据总览) / `Categories`(技术/衍生品/盘口/链上/情绪/宏观分类页) /
    `Trading`(交易评测总览：账户计分卡+权益曲线+持仓+交易/不交易记录) / `TradeDetail`(单笔交易独立详情页：走势图+决策依据+持仓管理+事件+结果+复盘)。

后端给前端的取数端点：`/metrics/catalog`(全量目录) · `/metrics/available?symbol`(覆盖) ·
`/metrics?symbol&names`(序列) · `/watchlist` · `/price` · `/catalysts/stored` · `/trading/*` · `/chat[/stream]`。

---

## 部署 `deploy/` 与文档 `doc/`
- `deploy/` — `fanisl-api/collector/trader.service`、`nginx-fanisl.conf`、`.env.example`、`README.md`(Debian13)。
- `doc/` — `data-inventory`(数据现状) · `trader-data`(交易数据) · `data-sync`(改动同步清单) ·
  `data-upgrades`(升级路线) · `database`/`*-design`(早期设计) · 本文。

## 运行时数据流（一图）
```
collector(15min) ─ get_market_snapshot → flatten → metric_samples(行情时序)
                  └ get_catalysts → catalyst_items(事件快照)
backfill(一次性) ─ 历史 OHLCV/funding/链上/宏观 → metric_samples（多年历史）
trader ─ scan(4h,Claude) → open_trade → 引擎撮合 → 持仓盯市(15s) → 唤醒重评 → 平仓复盘 → fanisl_trading
api ── 前端/对话取数；Claude 工具读 metric_samples / catalyst_items 做分析
```
