# 数据持久化 + 可视化 设计（2026-06-07）

> **[历史设计]** 持久化初版设计。现状以 [database.md](database.md) 与 [project-structure.md](project-structure.md) 为准。

把"实时取数即用即弃"升级为"主动采集时间序列 + 持久化 + 前端可视化"。
核心：后台调度器定时抓 watchlist 全维度 → 规整时间序列入库 → 只读 API → 前端图表。

## 目标与边界
- **要**：watchlist 的多维度时间序列持久化；前端"市场"视图画趋势图 + 概览 + 催化剂列表。
- **不做（v1，YAGNI）**：OHLC 蜡烛（价格按采样频率存成一条线）；Claude 读历史的新工具
  （Claude 仍实时取数，读历史为后续易加项）。

## 存储（SQLite，沿用 `fanisl.db`，纯加表；新模块 `marketstore.py` 与对话存储 `storage.py` 分离）
- `metric_samples(scope, symbol, metric, ts, value)`：所有标量时间序列。
  - `scope` = `symbol`（单币）| `global`（全市场，symbol 记 `GLOBAL`）。
  - 主键/唯一 `(scope, symbol, metric, ts)`，重复 **upsert**；索引 `(symbol, metric, ts)`。
  - 一次采集周期内所有样本共用同一 `cycle_ts`（截断到分钟）→ 全市场指标（恐惧贪婪/稳定币）
    天然去重成一行/周期；单币指标一行/币/周期。
- `catalyst_items(kind, symbol, event_date, title, payload_json, fetched_at)`：列表型
  （unlock/macro/news）。刷新时按 `(kind, scope)` 先删后插 = 最新快照语义。
- `collection_runs(started_at, ok, note)`：采集运行日志（前端显示数据新鲜度 + 排障）。

## 采集（进程内后台线程调度，**不写任何 shell 脚本**，依赖零新增）
- `flatten.py`（纯函数，可单测）：`flatten_snapshot(MarketSnapshot, cycle_ts) -> list[sample]`、
  `flatten_catalysts(CatalystReport) -> list[item]`。模型 → 行的唯一映射处；加数据源 = 加一行映射。
- `collector.py`：`collect_market(...)` 对每个 watchlist 币调**现有** `get_market_snapshot` →
  flatten → 写库；`collect_catalysts(...)` 调现有 `get_catalysts` → flatten → 写库。
  best-effort：单币/单源失败只记 `collection_runs.note`，不影响其余。**不碰任何数据源代码**。
- `scheduler.py`：`threading.Thread` 循环 + `Event` 停止；按 job 的 interval 到点触发。
  - market（价格/衍生品/情绪/链上，全在一次 snapshot 里）：每 **15 分钟**。
  - catalysts（解锁/宏观/新闻）：每 **天**。
  - FastAPI `startup` 启动、`shutdown` 停止；`collector_enabled` 配置可关（测试不启）。

## 采样指标（flatten 映射，scope 标注）
- 单币：`price`、`rsi_1d`、`funding_rate`、`open_interest_usd`、`lsr`、`top_trader_lsr`、
  `basis_perp`、`basis_quarterly`、`dvol`、`atm_iv`、`put_call_ratio`、`max_pain`、
  `liq_long_24h`、`liq_short_24h`、`chain_tvl`、`active_addresses`(BTC)。
- 全市场：`fear_greed`、`stablecoin_total`。
- 催化剂：unlock（按币，下次解锁）、macro（全市场日历）、news（按币/大盘）。

## 读取 API（只读，给前端）
- `GET /watchlist` → 每币最新关键指标（概览卡片）。
- `GET /metrics?symbol=&names=&since=` → 多指标时间序列（图表）。`symbol=GLOBAL` 取全市场。
- `GET /catalysts/stored?symbol=` → 存好的解锁/宏观/新闻。
- `GET /collection/status` → 最近采集时间/状态（新鲜度）。

## 配置（`config.py`）
- `watchlist: list[str] = ["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","XRP/USDT"]`
- `collect_market_interval_s = 900`、`collect_catalysts_interval_s = 86400`、`collector_enabled = True`

## 测试（不联网）
- `flatten_*` 纯函数：合成模型 → 断言行。
- `marketstore`：内存/临时 SQLite，upsert/查询/先删后插。
- 读取 API：mock store。
- collector：mock `get_market_snapshot`/`get_catalysts`，断言写库行数/内容。

## 前端（本轮先后端，前端随后）
"市场"视图：概览卡片（价格+24h+资金费+恐惧贪婪+sparkline）、单币多线时间序列图
（价格叠加可勾选信号）、催化剂面板。图表库 Recharts。
