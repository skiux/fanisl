# fanisl 后端 API 文档

> 面向前端（完全重写）的完整接口契约。以运行中后端实测采样为准（2026-07-17，共 50 个端点）。
> 服务：FastAPI，默认 `http://127.0.0.1:8000`（前端用 `VITE_API_BASE` 覆盖）。

## 0. 全局约定

- **无认证**（本机单用户）。CORS 全放开。
- **错误**：非 2xx 返回 `{"detail": "人类可读的中文原因"}`。常见：400 参数问题、404 不存在、
  409 状态冲突（如撤已成交的单）、502 Claude API 错误（同步调 Claude 的端点）。
- **时间**：一律 ISO 8601 带时区（如 `2026-07-12T20:00:00+08:00`）；日线日期为 `YYYY-MM-DD`。
- **耗时端点**：标注 ⏳ 的端点同步调用 Claude，可能 10s~2min，前端须给等待态与失败重试。
- **列表分页**：无游标分页，一律 `limit` 截断（各端点有默认与上限）。
- **数据刷新**：市场/知识数据由 collector 进程后台写库，API 只读；前端轮询即可
  （知识引擎数据日更，30-60s 轮询足够；价格条可 5-10s）。

---

## 1. 系统

### GET /health
`{"status":"ok","model":"<claude model>","exchange":"binance"}` — 存活探针。

---

## 2. 对话（盘面分析助手）

### POST /chat ⏳
非流式问答。Body `{"message": str, "conversation_id": int|null}`（null/0=新建对话）。
返回 `{"conversation_id": int, "reply": str}`。

### POST /chat/stream ⏳
SSE 流式（POST body 同上；用 fetch+ReadableStream 读，EventSource 不支持 POST）。
事件序列：`start → (delta|status)* → done|error`，每个事件 `data:` 为 JSON：

| event | payload | 语义 |
|---|---|---|
| `start` | `{conversation_id}` | 对话已建/定位，开始生成 |
| `delta` | `{text}` | 正文增量（逐段追加渲染） |
| `status` | `{phase:"tool", tool:名, input:{}}` | Claude 正在调工具（显示"查询中"态） |
| `done` | `{conversation_id}` | 本轮结束 |
| `error` | `{detail}` | 出错（流终止） |

### GET /conversations
`[{id, title, created_at, updated_at}]`，按更新时间倒序。

### GET /conversations/{id}
`{id, title, created_at, updated_at, messages: [{role:"user"|"assistant", content:str}]}`
（messages 已折叠为纯文本气泡，工具往返已剔除；content 是 markdown）。

### PATCH /conversations/{id}
Body `{"title": str}` → `{"ok":true}`。改名。

### DELETE /conversations/{id}
`{"ok":true}`。删除对话及消息。

---

## 3. 实时价格与市场数据

### GET /price?symbols=BTCUSDT,ETHUSDT
价格条轮询。每项 `{symbol, last: number|null, change_pct_24h: number|null, error?: str}`
——单标的失败不影响其他（error 存在时 last 为 null，前端显示占位）。
注意：Binance 被墙时 crypto 项会长期带 error，属预期状态。

### GET /watchlist
`{"symbols":[{symbol, metrics:{<name>: value,...}}...], "global":{<name>: value}}`
每标的最新关键指标快照 + 全市场（GLOBAL）指标。字段名见 /metrics/catalog。

### GET /metrics?symbol=BTCUSDT&names=price_usd,rsi_1d&since=2026-06-01
时间序列。`{"symbol", "series": {<name>: [{ts, value}...]}}`。`symbol=GLOBAL` 取全市场指标。

### GET /metrics/catalog
指标登记表（SSOT）：`{"timeframes":["1w","1d","4h","1h","15m","5m"], "metrics":[
{name, category, unit, scope:"symbol"|"global", label(中文), ts_meaning:"candle"|"event"}]}`。
前端所有指标的枚举/命名/单位以此为准。

### GET /metrics/available?symbol=BTCUSDT
该标的实际有数据的指标及覆盖：`{"symbol","coverage":[{metric, samples, first_ts, last_ts, last_value}]}`
——先查这个决定展示哪些图、历史多深。

### GET /catalysts/stored?symbol=
催化剂/新闻流。`[{kind, symbol, event_date, title, fetched_at, payload:{published_at, title, source, url, summary}}]`。

### GET /collection/status
`{"enabled": bool, "runs":[{job, started_at, ok:0|1, note}]}` — 采集器最近运行状态。

---

## 4. 交易评测台

多账户对照实验：`main`（自然）/ `forced`（强制交易）/ `setups`（playbook 信号）/
`live`（手动镜像实盘）等。所有 `account` 参数传账户名，不传=main。

### GET /trading/accounts
全部账户概览（账户切换器数据源）：
```
[{name, id, force, managed, mirror_of, setups, manual,
  summary: {balance, initial_balance, equity, used_margin, max_leverage,
            margin_mode, default_risk_pct, force_trade, open_positions:[...]},
  scorecard: {account_id, closed_trades, win_rate, avg_r, expectancy_r, profit_factor,
              total_pnl, max_drawdown, balance, avg_exit_efficiency,
              total_mgmt_contribution_r,
              calibration: [{bucket:"55-65", n, win_rate}],
              decline_accuracy: {verified, correct, accuracy}}}]
```
R 相关字段以风险单位计（1R=计划止损距离）；calibration 是"Claude 信心分桶 vs 实际胜率"。

### GET /trading/account?account=
单账户 `{summary, scorecard}`（结构同上）。

### PATCH /trading/account/force
Body `{"enabled": bool, "account": str|null}` → `{"force_trade": bool}`。

### GET /trading/positions?account=
未平仓实时快照（空仓返回 `[]`）：
`[{trade_id, symbol, side, leverage, qty, avg_entry, liquidation_price, opened_at,
sl_price, tp_targets, wake_conditions, mark, upnl, dist_sl, dist_tp, holding_s, snapshot_ts}]`
（mark/upnl 等来自最新盯市快照，无快照时为 null）。

### GET /trading/trades?account=
交易列表（含已平）：`[{id, account_id, symbol, side, strategy_type, leverage,
status:"planned"|"open"|"closed"|"cancelled", qty, avg_entry, liquidation_price, margin,
opened_at, closed_at, created_at, setup_key,
pnl_abs, pnl_pct, realized_r, outcome:"win"|"loss"|null, exit_reason, holding_s, skill_vs_luck}]`。

### GET /trading/trades/{id}
单笔全貌（证据链）：
`{trade, plans:[各版计划], orders:[委托], snapshots:[持仓快照], events:[事件流], result, review}`
plan.plan 内含 mtf（多周期分析文本）、entry/sl/tp、thesis 等 Claude 决策原文——详情页直接渲染。

### POST /trading/trades/{id}/cancel
撤 planned 状态的限价单 → `{"cancelled": bool, "trade_id"}`；非 planned 返回 409。

### GET /trading/declines?account=
Claude 拒绝交易的记录（决策审计）：`[{id, account_id, symbol, reason(长文本), ...}]`。

### GET /trading/symbols
`{"symbols":[...]}` 可交易标的（下拉数据源，crypto+美股+商品混合）。

### POST /trading/open ⏳
Body `{"symbol": str, "account": str|null}` — 让 Claude 评估并决定开仓（可能拒绝）。

### POST /trading/tick?account=
推进一拍（撮合/盯市/止损止盈/自主管理）→ 引擎周期结果 dict。

### POST /trading/scan?account= ⏳
触发一次自主扫描（同 4h 调度任务）。

### POST /trading/detect?account= ⏳
跑一轮 setup 探测 + veto 验证 → `{"detected": ..., "vetoes_verified": ...}`。

### GET /trading/setups?account=
Playbook 评测核心视图：
```
{registry: {<setup_key>: {key, name, hypothesis_ref, status, symbols, risk_pct, leverage,
                          sl_atr_mult, tp_atr_mult, holding_hours, cooldown_hours,
                          prior: {n, hit_rate, avg_net_return, ci_low, source, regime_notes}}},
 scorecard: [按 setup 聚合的 live 战绩，与 prior 对照],
 signals: [{id, setup_key, symbol, side, features, verdict:"confirm"|"veto",
            veto_category, reasoning, trade_id, hypo_entry_price, hypo_horizon_hours,
            hypo_outcome, created_at}]}   // signals 仅指定 account 时返回
```

### POST /trading/manual/open
手动镜像实盘进场（Claude 不介入）。Body：
`{account?("live"), symbol, side, setup_key, entry_type("market"|"limit"), entry_price,
sl_price, tp_price?, risk_pct(1.0), leverage(2.0), thesis?}`。

### POST /trading/manual/{trade_id}/close
Body `{"reason": str|null}` — 市价全平镜像仓。

---

## 5. 知识引擎

> 领域模型（渲染前必读）：
> **L0 content**（转录原文，不可变）→ **L1 unit**（提取单元：claim 判断 / method 方法 /
> concept 认知，quote=逐字引文是证据）→ **L2 score**（claim 到期机械评分）→
> **node**（跨内容归并的规范知识节点，挂 attestation 提及）→ **relation**（节点间对立/互补边）。

### 5.0 枚举与 payload 结构（前端渲染契约）

**unit.kind**：`claim`（判断）/ `method`（方法）/ `concept`（认知）。

**claim payload**（`unit.payload`，kind=claim）：
```
{asset_text, asset_symbol|null, priceable: bool,
 claim_class: price_target|directional|relative|event_outcome|timing|risk_warning,
 direction: up|down|flat|range|vol_up|vol_down|null,
 magnitude: {target?|low?|high?|pct?|baseline_date?}|null,
 horizon: {type: by_date|within_duration|open_ended, deadline?, duration_days?},
 condition_text|null, condition_observable: bool,
 stance_strength: explicit|hedged(对冲表述)|speculative(试探表述),
 verifiability: A|B|C|D,        // A 全自动可评 / B 期限系我方阶梯 / C 带条件按约定 / D 不可评
 scoring_spec: {method: sign|target_touch|target_close|range_hold|relative_return,
                eval_ladder: ["YYYY-MM-DD"...], benchmark|null, success_def(中文判据)}|null}
```
D 级无 scoring_spec；含糊率=D 占比，本身是信源指标。

**method payload**：`{name, summary, family: trend|reversion|carry|event|flow|positioning|other,
rules: [str], claimed_performance|null, data_requirements: [str],
overlap_with_killed: [str], testability: A|B|C}`。

**concept payload**：`{canonical_statement, category: risk_mgmt|psychology|market_structure|
regime|execution|macro_framework|other, stance: assert|reject, regime_qualifier|null}`。

**score.outcome**：`hit`(✓) / `partial`(½) / `miss`(✗) / `condition_not_met`(条件未触发) /
`condition_unverifiable`(条件不可验) / `unpriceable`(无价格)。命中率=(hit+0.5·partial)/(hit+partial+miss)。

**node.status**：`active`(单次提及) / `corroborated`(≥2 内容提及) / `verified`(评分≥3 且命中≥65%) /
`contested`(被反驳或命中≤35%) / `retired`(人工退役)。

**attestation.relation**：`restates`(重申) / `refines`(细化) / `supersedes`(修正取代，节点
canonical 已取最新表述) / `contradicts`(否定)。

**node relation（边）**：`conflicts`(对立命题，跨源分歧) / `relates`(高置信互补)。

**content.status**：`new`→`extracted`（当前全部 extracted）。

### 5.1 信源与内容（L0）

#### GET /knowledge/creators
`[{id, name, lang, focus, notes, active, created_at, handles:[{platform, handle, url}]}]`

#### GET /knowledge/contents?status=&limit=200
内容列表（无 raw 全文）：
`[{id, creator_id, creator, platform, url, content_type, title, published_at, fetched_at,
lang, status, raw_len, n_units, n_claims, n_methods, n_concepts, n_hit, n_partial, n_miss}]`
按发布时间倒序。n_hit/n_partial/n_miss 是该篇 claim 的已到期评分聚合（卡片角标用）。

#### GET /knowledge/contents/{id}
单篇全文：`{...同上, raw}`。**raw 排版约定**：转录正文 + `\n## 视觉笔记（画面信息，带时间戳）\n`
+ 若干 `- [MM:SS] (chart|table|text_slide|other) 描述` 行——前端按此切分正文与画面笔记。

#### GET /knowledge/contents/{id}/units
该篇的全部单元：`[{id, run_id, content_id, creator_id, published_at, kind, quote, locator
(视频时间点 MM:SS|null), extractor_version, model, payload, tags:[str],
ref_price_at_publish|null, created_at, scores:[{horizon_label, outcome, realized}]}]`
（claim 优先排前；scores 为空数组=尚无到期评分）。

### 5.2 单元浏览与检索（L1）

#### GET /knowledge/units?kind=&creator=&tag=&symbol=&q=&limit=200
跨内容单元浏览 + 全文检索（q 匹配 quote 与 payload）。返回结构同上另加
`creator`(名), `content_title`。上限 500。

#### GET /knowledge/units/{id}
单元详情：同上另加 `content_url`。

#### GET /knowledge/tags
标签枢纽：`[{tag, n, n_claims, n_methods, n_concepts}]` 按使用数倒序。

### 5.3 节点与关系（沉淀层）

#### GET /knowledge/nodes?kind=&status=&tag=&cross_source=&limit=300
规范知识节点列表：
`[{id, kind, title, canonical, status, tags, notes, merger_version, created_at, updated_at,
n_attest, n_creators, n_contents, first_seen, last_seen, hit, partial, miss}]`
按提及数倒序；`cross_source=true` 只看跨信源共识（n_creators≥2）。
hit/partial/miss 是节点关联 claim 的评分聚合。

#### GET /knowledge/nodes/{id}
节点详情：`{...同上, attestations:[{relation, note, unit_id, kind, quote, locator,
published_at, tags, payload, creator, content_id, content_title, scores:[...]}],
relations:[{relation, note, other_id, other_title, other_kind, other_status}]}`
attestations 按发布时间排=知识的时间演进线。

#### GET /knowledge/relations?relation=conflicts|relates
关系边全量（发现页数据源）：`[{id, relation, note, created_at,
a_id, a_title, a_kind, a_status, b_id, b_title, b_kind, b_status}]`。
conflicts=跨源对立命题（注意 note 里写明对立点），relates=高置信互补。

### 5.4 验证（L2）

#### GET /knowledge/scoreboard
信源联赛表：
`[{creator_id, name, claims, d_claims, methods, concepts, scored, hits, partials, misses,
cond_not_met, hit_rate|null, vague_rate|null, sign_n, sign_hits, sign_p|null,
sign_side:"above"|"below"|null}]`
sign_p 是方向类判断 vs 50% 随机基线的单侧二项检验（仅 sign 类有天然基线；样本小 p 无意义，
如实展示并配说明文案）。

#### GET /knowledge/recent-scores?days=14&limit=100
新到期评分流（按落库时刻倒序）：`[{id(score_id), unit_id, horizon_label, outcome,
realized:{ref?, eval_close?, asset_ret?, bench_ret?, ...}, eval_ts, scored_at,
kind, quote, payload, creator, ...}]`。

#### GET /knowledge/verification-queue?days=14&limit=120
验证中心行动队列：`{overview:{due, completed, unavailable, review},
due:[未来 days 天将到期且未评的 claim 时点（从冻结 eval_ladder 反查）],
recent:[近期已判定（hit/partial/miss）], unavailable:[不可判（unpriceable/condition_unverifiable）],
review:[需复核（condition_not_met/pending）]}`。
行结构：due 项 `{unit_id, quote, payload, published_at, ref_price_at_publish, creator,
content_title, horizon_label}`；其余三组另带 `{score_id, outcome, realized, eval_ts, scored_at}`。

#### GET /knowledge/verifications/{score_id}
单次评分完整档案（判定下钻页）：`{score_id, unit_id, horizon_label, outcome, realized,
eval_ts, scored_at, scorer_version, quote, locator, payload, ref_price_at_publish,
creator, content_id, content_title, content_url, published_at, node_id?, node_title?}`。

#### GET /knowledge/prices?symbol=XAUUSD&since=2026-06-01&until=
claim 证据图的日线窗口：`{symbol, note(代理口径说明，如"COMEX 金期货近月代理现货"),
bars:[{ts:"YYYY-MM-DD", open, high, low, close}]}`。
symbol 用 claim 的 asset_symbol 口径（NDX/SPX/SOXX/XAUUSD/WTI/DFEDTARU 等 39 个）。
用途：在图上标 ref_price、判界（magnitude.low/high/target）、eval_ladder 时点与 outcome。

### 5.5 发现与运营

#### GET /knowledge/harness-candidates
可回测方法清单（testability=A）：`[{node_id, title, canonical, status, n_attest, n_creators,
payload(完整 method payload：rules/data_requirements/overlap_with_killed)}]`。

#### GET /knowledge/weekly?days=7
周报（现算现返，同时落盘 data_export/reports/）：
`{generated_at, path, markdown, summary:{new_contents, new_units,
new_scores:[带 unit_id/creator/sym/dir/grade/outcome/horizon_label],
new_edges, node_status, notable_nodes, due_next:[未来7天将到期时点], spot_check:{checked,total}}}`
markdown 可直接渲染；summary 供结构化展示。

#### GET /knowledge/spot-checks
抽查覆盖：`{total, checked, faithful, unfaithful, unclear,
recent:[{unit_id, verdict, note, created_at, kind, quote}]}`（录入走 CLI，API 只读）。

---

## 6. 研究档案

### GET /research/docs
`[{name, title}]` 白名单文档索引（capstone / research-log / eval-repositioning / knowledge-engine）。

### GET /research/docs/{name}
`{name, title, path, content(markdown 全文)}` — 前端直接渲染 markdown。

---

## 附：前端信息架构提示（非约束）

- 知识引擎的对象链路：**节点（可复用知识）→ 提及（unit 证据）→ 内容（L0 原文）→ 评分（市场裁决）**，
  任何视图都应保留这条下钻链；
- 联赛表/周报/抽查是运营视图，信息密度低、更新慢，不应占据主导航主位；
- claim 渲染三要素：主张（asset+direction+magnitude+期限）、证据（quote+locator）、
  裁决（scores 徽标 + success_def 口径）；
- 样本仍小（62 个已到期时点），任何百分比旁都应带 n，避免暗示统计显著性。
