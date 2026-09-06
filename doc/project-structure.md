# fanisl 项目结构（详解）

更新于 2026-08-19。fanisl = **知识引擎（当前主线）** + 多资产时点数据平台
+ 交易评测台（实盘镜像/setup 评 edge）+ 量化研究 harness（已收官，按需复用，
见 [research-capstone.md](research/research-capstone.md)）。
核心理念：**先把数据做对**。后端 FastAPI（3 进程）+ React/TS 前端 + PostgreSQL/TimescaleDB。

**三个库，不要混**：`fanisl_knowledge`（知识引擎，13 表，无 TimescaleDB）·
`fanisl`（行情时序，metric_samples hypertable；**timescaledb 是可选依赖**，扩展缺失时
退化成普通表，开发机不装也能跑，只有 4 个用例会 skip）· `fanisl_trading`（评测台）。
`analyzer.runtime` 在 import 时就打开全部三个池，少一个进程起不来。

```
fanisl/
├── backend/      Python 后端（FastAPI + 数据管道 + 知识引擎 + 交易评测台）
│   ├── src/analyzer/knowledge/   知识引擎（含 extraction-guide / merge-guide 两份冻结规范）
│   │                              + asset_view.py（按标的聚合的读模型，标的工作台的数据脊柱）
│   │                              + reference.py（asset_profiles / news_items / asset_events 三表 + 刷新 CLI）
│   │                              + news_triage.py（动态降噪：确定性规则 + LLM 判相关，只筛不判）
│   └── tools/                    运维脚本：check_db / check_sources / check_ingest
├── frontend/     React + TS + Vite 前端（知识引擎，挂 /）
├── console/      React + TS + Vite 前端（资产台，挂 /console/）
├── shared/       两个前端共用的东西
│   └── login/                    登录页。一套账号一个域名，只该有一扇门
├── deploy/       部署指南 + systemd 单元 + nginx + .env 模板
│                 + backup.sh（服务器备份）+ auto-update.sh（自动更新）
│                 + pull-snapshot.sh（拉本机快照）
├── data_export/  提取产物（knowledge_units 的 JSON 是"人参与那一步"的凭据与重放日志）
│                 + keyframes（gitignore）+ reports（周报，同为生成物，2026-08-28 起 gitignore）
└── doc/          设计/数据文档
```

**运行形态（2026-08-18 起）**：服务器（GCE 新加坡）跑无人值守的那半条——collector 的
知识引擎日维护/周报、转录、API；服务器库是唯一真库。提取/归并/关系边/抽查仍在会话侧，
经 SSH 隧道写服务器库。详见 [deploy/README.md](../deploy/README.md)。

---

## 后端 `backend/src/analyzer/`

### 进程入口（3 车道，见 deploy/README）
- `main.py` — FastAPI app，**只服务请求**（不起后台调度），可多 worker。所有 HTTP 路由。
- `worker_collector.py` — 采集进程。**两条调度车道**（Scheduler 是单线程顺序执行的，
  刷公司资料受 Polygon 限速要跑十几分钟，与行情同车道会把 15 分钟一轮的采集顶掉）：
  ①market 15min / catalysts 每天 / 知识日维护 / 周报；
  ②标的新闻天更 + 财报日历天更 + 动态降噪天更 + 公司资料周更。单实例。
- `worker_trader.py` — 交易进程：快线程盯市(15s) + 慢线程（setup 探测→闸门 1h；scan 已默认关）。单实例。
- `worker_base.py` — worker 公共设施：PG advisory lock 单实例守卫 + 信号驱动运行。
- `backfill.py` — 一次性历史回填（`python -m analyzer.backfill`）。
- `migrate_sqlite.py` — 旧 SQLite → PG 一次性迁移。

### 组合根 / 配置
- `runtime.py` — **共享对象装配**（pool/store/resolver/agent/trading_service/ACCOUNT_ID
  + user_store + binance_client/binance_cache）。三个入口都 import 它，各进程各建一份。
- `config.py` — 集中配置（pydantic-settings）：API key、阈值、交易参数、采集/扫描节奏、
  登录与会话、Binance 只读凭据。

### 登录与用户 `auth/`（2026-09-02，全站默认关门）
中间件**默认拒绝**：新加的路由自动受保护，放行必须显式进白名单（只有 `/health`、
`/auth/login`、`/auth/logout` 三条）。2~3 个成员 + 1 个管理员，**共用同一个 Binance
只读账户**——用户系统解决的是"谁能看"，不是"看谁的"。
口令用 stdlib scrypt（不引编译依赖）、会话 token 只存 sha256、CSRF 靠 SameSite=Lax。
详见 [`auth/README.md`](../backend/src/analyzer/auth/README.md)。

### 资产台数据层 `binance/`（2026-09-02，盈亏口径 09-06 重做）
给 `console/` 供数的三组接口：`/portfolio` `/orders` `/ledger`。
**不用 ccxt**——它的统一模型会抹掉这三页要的字段（现货四种锁定态、ADL 分位、
条件单的 workingType/closePosition、维持保证金档位、理财持仓）。
签名支持 Ed25519 / RSA / HMAC 三种 key（官方已把 HMAC 标为 deprecated）。
按来源缓存 + 按来源降级：451 常常只打在 fapi 上，现货那半边照常。

**盈亏口径是这个模块最容易搞错的地方**，`dailypnl.py` 一个文件说清：一天的盈亏 =
当天收盘市值 − 昨天收盘市值 − 当天进出；历史持仓量没有接口，从今天的余额往回滚，
而持有量按**跨钱包**统计让划转自动抵消。现货这一侧**没有任何相对成本的数**
（未实现与已实现都要完整买入历史，那段历史补不齐），合约那半边直接用交易所给的
`unRealizedProfit` / `REALIZED_PNL`。
详见 [`binance/README.md`](../backend/src/analyzer/binance/README.md)。

### 数据层 `data/`（抽象 + 多源，加/换源只碰这里 + factory）
- `base.py` — `MarketDataSource` 接口（OHLCV/ticker/衍生品/盘口）。
- `derivatives.py` / `catalysts.py` / `onchain.py` — 各类 Provider 接口 + 聚合 bundle。
- `ccxt_source.py` — 加密永续（默认 **Binance**；funding/OI/LSR/taker/盘口 + 历史端点）。
- `polygon_source.py`(美股/指数/ETF/原油) · `oanda_source.py`(金属) — TradFi 分析源。
- `deribit_source.py`(期权) · `coinalyze_source.py`(爆仓) · `alternativeme_source.py`(恐惧贪婪)。
- `defillama_source.py`(解锁/稳定币/TVL) · `blockchaininfo_source.py`(BTC 网络) · `fred_source.py`(宏观)。
- 新闻：`cryptocompare_/newsapi_/finnhub_/benzinga_source.py` + `news_aggregate.py`(聚合去重，最新快照语义)。
- 标的参考数据：`company_source.py`(Polygon 参考数据 + Finnhub 画像/指标，合并并逐字段记来源)
  · `asset_news_source.py`(Finnhub 按 ticker 的新闻，**只对个股与 ETF**)
  · `earnings_source.py`(Finnhub 财报日历，**只对个股**；EDGAR 那条留给研究回填，两者不冲突)。
- `lunarcrush_source.py`(社交，付费墙未启用)。
- 多资产/研究源：`cftc_source.py`(COT) · `edgar_source.py`(财报事件/XBRL EPS) · `yahoo_source.py`(股价)
  · `eia_source.py`(周度石油库存) · OANDA 的 `fetch_ohlcv_history/fetch_window`(H1/M1 深回填)。
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
- `assets.py` — **标的身份的 SSOT**（登记表，97 个）：中文名/类别/别名/各命名空间的符号。
  与 `data/instruments.py` 的分工：本表管"是什么"，那张表管"去哪取数"。
  `knowledge/prices.py` 的 SYMBOL_MAP 从这里派生——**改这里就是改每天的日线采集范围**。
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

### 交易评测台 `trading/`（2026-07 重定位后，见 [trading-eval-repositioning.md](trading-eval-repositioning.md)）
- `models.py` — 结构化产出：TradePlan(含 setup_key/time_exit_hours，酌情分析字段可选) / Adjustment /
  Review / SetupGateDecision(闸门) / EventAnnotation / ManualPlan(实盘镜像) / Decline。
- `playbook.py` — **setup 注册表**：SetupSpec+回测先验 / 确定性探测器 / 计划模板（方向点位由规则，非 Claude）。
- `trade_agent.py` — Claude 调用：**gate_setup(闸门：干净实例+定性否决)** + 进场/管理/复盘/扫描(酌情遗留)。
- `engine.py` — 确定性引擎：撮合/止损止盈/强平/到时平仓/盯市/唤醒监测/结果结算(含 bh_r 配对基准)。
- `calc.py` — 仓位/保证金/盈亏/强平价/事件风险打折 纯算。
- `service.py` — 编排：detect_setups(探测→闸门→开仓) / verify_vetoes / **manual_open/close(实盘镜像)**
  / mark / manage_and_review / scan(默认关)。
- `store.py` — 交易库 12 张表（+setup_signals 触发漏斗 / event_annotations 事件标注）；
  `scorecard_by_setup()` 按 setup 类型评 edge。详见 [trader-data.md](data/trader-data.md)。
- 账户：main/forced/shadow(历史对照，Claude 自主实验已关闭) · **setups**(playbook 纸面) · **live**(实盘手动镜像)。

### 量化研究 `research/`（收官，按需复用）
- `pit.py`(时点访问，无未来函数) · `stats.py`(bootstrap/零分布/FDR) · `screen.py`(IC 筛+lookahead 守卫)。
- `h1.py`~`h22.py` — 23 个预注册假设的回测（判据锁死）；裁决见 [research-log.md](research/research-log.md)。
- `backfill_*.py` — 7 个历史回填器（COT/股票/EPS/宏观/资金费/EIA/WTI 盘中/Binance bulk）。

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
    `Trading`(评测总览：5 账户切换+计分卡+权益曲线+持仓+记录) / `SetupsPanel`(playbook 评测板/你的 setup 表)
    / `ManualPanel`(实盘录入表单) / `TradeDetail`(单笔详情：走势+决策依据+管理+事件+结果+复盘)。

后端给前端的取数端点：`/metrics/catalog`(全量目录) · `/metrics/available?symbol`(覆盖) ·
`/metrics?symbol&names`(序列) · `/watchlist` · `/price` · `/catalysts/stored` · `/trading/*` · `/chat[/stream]`
· `/asset`(标的宇宙) · `/asset/{id}`(标的档案，含公司资料与按标的新闻)。

**`/asset` 是单数，不是 `/assets`**：Vite 的构建产物在 `/assets/index-*.js`，API 占用
`/assets` 会让 nginx 把前端 JS/CSS 代理到后端、页面白屏。三处守着这条：
`deploy/check_nginx_routes.py`、`frontend/vite.config.ts` 的 preview 代理（用正则键，不是前缀键）、
`frontend/e2e/api-fixture.ts` 的路由拦截（精确匹配 `/asset` 与 `/asset/`）。

---

## 部署 `deploy/` 与文档 `doc/`
- `deploy/` — `fanisl-api/collector/trader.service`、`nginx-fanisl.conf`、`.env.example`、`README.md`(Debian13)。
- `doc/` — `research-capstone`(研究收官) · `research-log`(23 个 H 裁决) · `phase*-prereg`(24 份预注册，不可改)
  · `project-transformation`(蓝图，已执行完) · `trading-eval-repositioning`(评测台重定位) · `data-gaps`(源与缺口)
  · `data-inventory` · `trader-data` · `data-sync` · `data-upgrades` · `database`/`*-design`(历史) · 本文。

## 运行时数据流（一图）
```
collector(15min) ─ get_market_snapshot → flatten → metric_samples(行情时序)
                  └ get_catalysts → catalyst_items(事件快照)
backfill(一次性) ─ 历史 OHLCV/funding/链上/宏观 → metric_samples（多年历史）
trader ─ setup 探测(1h) → Claude 闸门 → 引擎撮合 → 盯市(15s)/到时平仓 → fanisl_trading
用户  ─ 实盘手动镜像(live 账户) → 同一引擎评测 → 按 setup 聚合 scorecard
api ── 前端/对话取数；Claude 工具读 metric_samples / catalyst_items 做分析
```
