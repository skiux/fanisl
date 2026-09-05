# fanisl 后端 API 文档

> 面向前端的完整接口契约。以运行中后端实测采样为准（2026-07-18 首版 50 个端点；2026-08-28 复核实际 60 个；
> 2026-08-29 标的工作台 +2 = 62 个；2026-09-02 登录与用户管理 +11、资产台 +3 = **76 个**）。
> 服务：FastAPI，默认 `http://127.0.0.1:8000`（前端用 `VITE_API_BASE` 覆盖）。
>
> 配套文档：`PRODUCT.md`（产品定义/信息架构/用户旅程）· `domain-model.md`（知识引擎
> 领域模型与枚举中文标签 SSOT）。
> 本文只管传输层：有哪些端点、参数与返回结构。

## 0. 全局约定

- **全站需要登录**（2026-09-02 起）。会话走 cookie `fanisl_session`
  （`HttpOnly` + `Secure` + `SameSite=Lax`），同源请求浏览器自动带上，前端不用管。
  未登录一律 `401 {"detail": "未登录或会话已过期"}`——**前端见到 401 就跳登录页**。
  免登录的只有三条：`GET /health`、`POST /auth/login`、`POST /auth/logout`。
  详见 `backend/src/analyzer/auth/README.md`。
- **CORS**：线上两个前端与 API 同源，用不到 CORS。本机跨端口开发时要带 cookie，
  浏览器不允许 `Access-Control-Allow-Origin: *`，所以来源要逐个列进 `CORS_ORIGINS`。
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
`{"status":"ok"}` — 存活探针，**全站唯一不需要登录的数据端点**。

只回存活与否：它回什么都等于公开。原先还带 model 与 exchange，但没有调用方读
（前端不用，`auto-update.sh` 只看状态码）。要看生效配置进程启动第一屏就打印了。

---

## 1.5 登录与用户

完整说明见 `backend/src/analyzer/auth/README.md`，这里只列传输层。

### POST /auth/login
Body `{"username": str, "password": str}` → `{"user": {...}}`，并在响应里种
`Set-Cookie: fanisl_session=...`。用户名大小写不敏感。

失败一律 `401 {"detail":"用户名或口令不正确"}`——用户名不存在与口令错误**返回同一个
文案、耗时也一致**，不要指望从中区分。触发限速时是 `429`（同一用户名 15 分钟内失败
5 次，或同一 IP 20 次；一次成功登录即清零）。

### POST /auth/logout
销毁会话并清 cookie。幂等：没有会话时也返回 `{"ok": true}`。

### GET /auth/me
`{"user": {id, username, role, display_name, is_active, created_at, updated_at, last_login_at}}`。
`role` 是 `"admin" | "member"`。**前端启动时先打这一条**：200 就进主界面，401 就跳登录页。

### POST /auth/password
`{"current_password": str, "new_password": str}`。当前口令不对 → 401；新口令太短 → 400。
成功后**别处的会话全部作废，调用方自己续上新会话**（响应会重新种 cookie）。

### GET /auth/sessions · DELETE /auth/sessions
列出 / 撤销自己的全部会话。每条含 `created_at` / `last_seen_at` / `expires_at` /
`user_agent` / `ip` / `is_current`——最后一个标出正在用的那条（同一层 nginx 后面几台
设备的 IP 往往一样）。DELETE 连当前这条一起撤，之后需要重新登录。

### 管理员接口（`role=admin`，否则 403）

| 方法 | 路径 | Body | 说明 |
|---|---|---|---|
| GET | `/admin/users` | — | 用户列表 |
| POST | `/admin/users` | `{username, password, role?, display_name?}` | 201；用户名重复 409；用户名只允许字母数字下划线连字符，口令 <10 位 400 |
| PATCH | `/admin/users/{id}` | `{role?, is_active?, display_name?}` | 改角色或停用会踢掉该用户全部会话 |
| POST | `/admin/users/{id}/password` | `{new_password}` | 重置，该用户全部会话作废 |
| DELETE | `/admin/users/{id}` | — | 删除 |

409 的四种情况：停用或降级最后一个管理员、删除最后一个管理员、停用自己、删除自己。

---

## 1.8 资产台（Binance 只读）

三组接口给 `console/` 供数。**形状的权威定义是 `console/src/api/types.ts`**，
后端按它组装；实现与全部取舍见 `backend/src/analyzer/binance/README.md`。

全员共用同一个 Binance 账户（凭据在服务器 `.env`，只开 Enable Reading）。

**共同约定**：
- 每个响应都带 `sources: SourceState[]`，**按来源逐个报状态**。451 常常只打在 fapi 上，
  现货那半边照常——前端据此分块降级，不要整页判死。
- `status` 五种：`ok | unreachable | unauthorized | rate_limited | unsupported`。
  `unauthorized` 是"去查 key 权限与 IP 白名单"，`unreachable` 是"等网络"，处置不同。
- 取数失败但有旧数据时，**返回旧数据 + 真实失败原因 + 旧时刻**（不是当前时刻）。
- **取不到一律 `null`，绝不用 `0` 顶替**——`0` 是一个有效余额。
- `as_of` 取**最旧的那个成功来源**：整页的可信时刻由最落后的那块决定。

### GET /portfolio
Query：`force`（默认 false，界面上的"重新取数"，只有管理员看得到这个按钮）。
返回 `PortfolioSnapshot`：`totals` / `wallets` / `spot` / `futures` / `earn` / `margin` /
`income` / `transfers` / `pnl`。

`force` **不穿透提现历史**（单次权重 18000，是所有端点里最贵的一个）。

#### `pnl` —— 盈亏，按成交算，不由资产变化倒推

这一块的口径是整份接口里最容易搞错的地方，2026-09 连着修过四轮，每一轮的错都写在
`backend/src/analyzer/binance/README.md` 里。要点：

- **不能用"期末 − 期初 − 净充提"。** `accountSnapshot` 只覆盖 SPOT / MARGIN / FUTURES
  三种钱包，理财、资金、币本位、期权都没有历史快照。拿它当期初、拿全部钱包当期末，
  差额会被整个算成盈亏；而钱包之间的划转（现货 → 理财）会直接变成一笔"亏损"。
  更糟的是残差反解会让恒等式永远闭合，错了也看不出来。**日快照相关的字段
  `equity_curve` / `attribution` 已经删除**，不要再依赖。
- 现在的口径：

  ```
  today.spot_mark_usd     现货盯市：Σ 持有量 × (现价 − 昨日 UTC 收盘)
  today.settled_usd       当日结算 = daily 最后一格
  today.total_usd         两项之和；today_usd 是它的别名（摘要条用）
  unrealized.futures_usd  positionRisk 的 unRealizedProfit（交易所标记价）
  realized.spot_usd       myTrades 全量重放，卖出按当时的均价结转（无时间上限）
  realized.futures_usd    income 的 REALIZED_PNL（接口只保留 90 天）
  carry.*                 资金费 / 手续费 / 返佣，同样 90 天
  daily[]                 每天**结算**落袋多少：income 逐行按天分桶 + 现货成交结转
                          固定 90 格，没交易的那天是 0 且 traded=false（不是缺一格）
                          **不含盯市**，所以最后一格 ≠ today.total_usd
  spot_marks[]            逐币今日涨跌：{asset, qty, price_usd, prev_close_usd,
                          value_usd, today_usd}
  spot_assets[]           逐币成本与已实现：{asset, qty, avg_cost_usd, price_usd,
                          value_usd, realized_usd, cost_known, is_cash}
  coverage                覆盖范围的实话（"已清仓的标的查不到交易对"）
  incomplete_assets[]     成本完全算不出来的币（缺跨币种历史汇率），已从合计剔除
  ```

- **现货没有"未实现"这一项，`unrealized` 里只有合约。** 现货的未实现是市值减加权
  平均成本，而那个成本要完整的买入历史——划转 / 理财派息 / 小额兑换进来的币从不
  出现在 `myTrades` 里，`capital/deposit/hisrec` 又只回 90 天，更早的充值永远查不
  回来。算出来的数永远缺一块（2026-09 为它修过三轮，一版虚高六倍）。
  **别在客户端拿 `qty × (price − avg_cost)` 自己算一个补回去。**
  现货要回答的是"今天涨跌了多少"，那用盯市，见 `today.spot_mark_usd`。
- **盯市的持有量是跨全部钱包的**（`held_across_wallets`）：划进合约当保证金、存进
  理财的币都算在里面。所谓"现货数据取不到"往往只是币不在现货钱包，量一直都在。
- **昨收取自 `klines(symbol, '1d', limit=2)` 的倒数第二根**——最后一根是今天这根、
  还在走，拿它当昨收今日盈亏永远是 0。取不到昨收的币 `today_usd` 为 `null`，
  不参与合计，也不按"没动"记 0。一个币都算不出来时 `spot_mark_usd` 是 `null`。
- `income` 的金额单位是该行的 `asset`，不一定是 USDT（手续费常用 BNB 抵扣）。
  已在服务端按币种换算成 USD，客户端不必再折算。
- 三块的窗口不一样是接口硬限，**不要把 `realized.spot_usd` 与 `realized.futures_usd`
  加成一个数**当作某个统一区间的成绩。

#### 成员只能看 90 天

非管理员的响应经 `main.py:_clip_for_member` 裁过：`pnl.daily` 只留最近 90 天，
`pnl.realized.spot_usd` 置为 `null`（它是全历史的）。**这一步在服务端做**——
前端把数字藏起来不算数。

### GET /orders
Query：`symbol`、`venue`（`spot|usdm|margin`）、`force`。

**当前挂单能一次拿全账户**，`open` 是完整的。**历史必须按交易对查**——`symbol` 省略时取
`history_symbols` 的第一个，`venue` 按该符号在哪边有仓位/挂单推断。`query` 里带着本次
实际的区间与该 venue 的接口上限（现货单次 ≤ 24 小时、合约 < 7 天、回溯 90 天）。

`history_symbols` 是从「有挂单 + 有持仓 + 现货余额能配出的交易对」推的候选——
Binance 没有"我交易过哪些对"的接口，做不到真正的全量。

### GET /ledger
Query：`days`（默认 7）、`force`。

Binance **没有统一的流水接口**，`entries` 是八个端点合并的时间线，每条带 `source`。
`days` 超过 30 会被截到 30——那是各来源上限的**交集**，卡在理财派息/杠杆利息/闪兑。
`window` 里带着本次实际的起止、天数、上限与卡住它的来源。

端点清单（路径、权重、单次上限、回溯天数、调用次数）**不再出现在响应里**：
它曾作为 `windows` 字段返回、在界面上画成一张表，那是接口的构造，属于文档不属于页面。
现在写在 `backend/src/analyzer/binance/README.md` 的接口清单一节，
`ledger.py:WINDOWS` 是唯一权威。

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

### GET /conversations/{id}/messages
完整历史（**含工具往返**），与上一条的区别：`/conversations/{id}` 已把消息折叠成纯文本
气泡供前端直接渲染，本端点返回 `storage.get_history` 的原始记录。前端一般用上一条，
排查 agent 行为时才用本条。conversation 不存在 → 404。

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

#### GET /knowledge/overview
首页和全局状态使用的未截断汇总：
`{contents, units, claims, methods, concepts, nodes, corroborated, creators}`。
contents 与各类 units 排除 `superseded` 的旧稿；nodes 保留全部生命周期状态；creators 只计 active。

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

#### GET /knowledge/contents/{id}/runs
该篇的全部提取版本：`[{id, extractor_version, model, n_units, status, created_at}]`，按时间升序。

**只有 `status='active'` 的那一版进下游统计**。升版重提（v1→v2）后旧版单元一条不删（版本化
重放），但若两版同时计入，联赛表、含糊率、抽查覆盖率都会把同一期内容数两遍——所以库层用
部分唯一索引保证一条内容最多一个 active run。切换走 CLI
`python -m analyzer.knowledge.import_units --activate <run_id>`（发现新版不如旧版就切回去）。

前端注意：`/contents/{id}/units`、`/units`、`/tags`、`/scoreboard`、`/spot-checks` 等
**返回的都只是生效版本**；要看历史版本得先从这里拿 run 列表。

#### GET /knowledge/contents/{id}/keyframes
该篇留存的关键帧，按视频内时刻升序：`[{id, content_id, ts_s, kind, note, path, height,
bytes, source, created_at}]`。`note` 是该时刻视觉笔记的原文，`path` 只作记录，**取图走
下面的 `/image` 端点，不要自己拼路径**。

帧数远少于笔记条数是正常的：只有"帧能回答笔记回答不了的问题"的时刻才留帧——`chart`/`table`
（折线形状、表格格子文字装不下），以及笔记里带精确数值的画面（数值会被转录改写，帧是仲裁）。
纯文字画面（章节标题卡、Logo、手写板书）不留：笔记就是那段文字本身。判据在
`backfill_keyframes.worth_a_frame`。

#### GET /knowledge/keyframes/{id}/image
帧图片本体（`image/jpeg`，1920×1080）。**按帧 id 取，路径由服务端从库里查**——接口不接受
调用方传路径。库里有记录但磁盘上没有时返回 404 并说明原因（多半是部署没配 `KEYFRAME_ROOT`）。

### 5.2 单元浏览与检索（L1）

#### GET /knowledge/units?kind=&creator=&tag=&symbol=&q=&limit=200
跨内容单元浏览 + 全文检索（q 匹配 quote 与 payload）。返回结构同上另加
`creator`(名), `content_title`。上限 500。

**`symbol` 是"按标的取全部单元"，不只是 claim**（2026-08-29 修正）：同时匹配
`payload.asset_symbol` 与资产标签，并按登记表解析别名——`XAU/USD`、`xauusd`、`GOLD`
三种写法结果相同。改之前只匹配 `asset_symbol`，NVDA 的 24 条认知、SOXX 的 12 条方法
一条都取不到。未登记的符号按原样精确匹配，照常可用。

#### GET /knowledge/units-page?kind=&creator=&tag=&symbol=&q=&scored=false&limit=100&offset=0
单元浏览的分页契约（`symbol` 语义同上）：`{items:[...], total, offset, limit, has_more,
counts:{claim, method, concept}, creator_counts:{creator_id:count}}`。排序固定为
`published_at DESC NULLS LAST, id DESC`；
total 与 counts 是当前服务端筛选的完整结果，不是当前页长度。默认排除 `superseded` 旧稿。
`scored=true` 只返回至少有一条市场裁决的单元。

#### GET /knowledge/units/{id}
单元详情：同上另加 `content_url`。

#### GET /knowledge/units/{id}/keyframes?window_s=90
该单元 `locator` 附近的帧——抽查"视觉笔记的读数忠不忠实"的落点。返回
`{unit_id, content_id, locator, locator_s|null, frames:[…同上 + distance_s], 
content_frame_span_s:[lo,hi]|null, warning|null}`，`frames` 按与 locator 的距离升序。
`window_s` 上限 600。

**`locator` 不可尽信，前端必须显示 `warning`**：长视频上模型会编时间戳——实测 c2 片长
25:57、视觉笔记却标到 53:37，unit #15（标普年底 8200 那条 A 级）的 locator `45:12` 指向
一个不存在的时刻。越界时不静默返回空数组，`warning` 会写明"时间戳很可能是模型虚构的，
判断请以 quote 为准"；与"该时刻附近本来就没抓帧"（纯文字画面）措辞区分开。

#### GET /knowledge/tags
标签枢纽：`[{tag, n, n_claims, n_methods, n_concepts}]` 按使用数倒序。

### 5.3 节点与关系（沉淀层）

#### GET /knowledge/nodes?kind=&status=&tag=&cross_source=&limit=300
规范知识节点列表：
`[{id, kind, title, canonical, status, tags, notes, merger_version, created_at, updated_at,
n_attest, n_creators, n_contents, first_seen, last_seen, hit, partial, miss}]`
按提及数倒序；`cross_source=true` 只看跨信源共识（n_creators≥2）。
hit/partial/miss 是节点关联 claim 的评分聚合。

#### GET /knowledge/nodes-page?kind=&status=&tag=&q=&limit=200&offset=0
长期知识索引的分页契约：`{items:[...], total, offset, limit, has_more}`。`q` 同时检索
标题、规范陈述和标签；排序固定为 `n_attest DESC, updated_at DESC, id DESC`，用于完整节点索引。

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

#### GET /knowledge/verification-summary?days=14
验证中心未截断汇总：`{overview:{due, completed, unavailable, review}, nearest_due:[最多4条]}`。

#### GET /knowledge/verification-page?bucket=recent&days=14&limit=100&offset=0
分类分页：`bucket=recent|due|review|unavailable`，返回
`{items, total, offset, limit, has_more}`。recent/review/unavailable 按评分落库时刻与 id 倒序；
due 按执行日期、发布时间与单元 id 确定排序。

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

## 6. 标的工作台

> **前缀是单数 `/asset`，不是 `/assets`。** Vite 把前端构建产物放在 `/assets/index-*.js`，
> API 一旦占用 `/assets`，nginx 会把前端的 JS/CSS 一起代理到后端、页面直接白屏。
> 前端路由是 `#/asset`、`#/asset?id={id}` 与 `#/asset?id={id}&view={分节}`
> （详情与分节都走 query，与知识库/验证中心一致；分节取值
> open/record/news/profile/tension/knowledge/trades/coverage——**不摆永远空的标签**：
> 没有"公司"的标的不给 news/profile，评测台没开过仓的不给 trades，库里没有知识单元的
> 不给 open/record/tension/knowledge）。

标的的规范 id 用 claim 的 `asset_symbol` 口径（`XAUUSD` 而非 `XAU/USD`），不含斜杠、URL 安全。
后端认别名（`XAU/USD` / `xauusd` / `GOLD` 都落到 `XAUUSD`），**返回的一律是规范 id**。
登记表是 `backend/src/analyzer/assets.py`（身份）；`data/instruments.py` 管的是行情路由，两张表别混。

统计口径与 `domain-model.md` §5 一致：`hit_rate = (hits + 0.5×partials) / scored`，
`scored` 只含 hit/partial/miss；`condition_not_met` 等归 `unresolved`，**不进分母**。
无样本时 `hit_rate` 为 `null`（不是 0）。**前端展示百分比必须带 n。**

### GET /asset?include_empty=false
标的宇宙。`{total, classes:{asset_class: 中文标签}, assets:[…]}`，每行：

| 字段 | 含义 |
|---|---|
| `asset` / `display` / `asset_class` / `class_label` | 规范 id / 中文名(可为 null) / 类别 / 类别中文 |
| `registered` | 是否在登记表里（false = 语料里出现了但没登记，是待补的缺口） |
| `units` / `claims` / `methods` / `concepts` | 该标的的知识沉淀（**三类都算**，不只是 claim） |
| `creators` / `first_seen` / `last_seen` | 几位信源讲过 / 首末提及时间 |
| `scored` / `hits` / `partials` / `misses` / `unresolved` / `hit_rate` | 战绩 |
| `open_claims` | **未到期判断的条数**（冻结阶梯里还没写评分行、且日期在今天或以后，按 claim 去重） |
| `has_bars` / `has_metrics` | 登记表声明的能力：有无日线源 / 有无全维度指标采集 |
| `bars` | daily_bars 实际覆盖 `{symbol, n, first, last}`，没有则 `null` |
| `news` | 新闻覆盖：`news_items` 走 `{asset, n, latest}`；加密标的回落到 catalyst_items 的 `{kind, symbol, n, fetched_at}`。没有则 `null` |
| `profile_at` | 公司资料的抓取时刻，没抓过则 `null` |

默认返回**库里真有知识单元、或评测台交易过**的标的（当前 75 个）。后一条是必要的：
BZ 实测 0 条知识单元、3 笔交易，只按知识单元筛它在工作台里无处可达。
`include_empty=true` 再把登记表其余部分带上，计数全 0、`hit_rate` 为 `null`。

排序：`units DESC, asset`。无分页（登记表规模 <200）。

### GET /asset/{id}
标的档案，页面首屏的全部聚合。未登记且库里也没单元 → 404；**登记了但还没有单元 → 200
且 `summary: null`**（"我们知道它是什么，只是还没人讲过它"≠"查无此物"，前端要分开渲染）。

```
{
  "asset": "XAUUSD",
  "identity": {id, display, asset_class, class_label, tag, aliases[], related[], note, registered},
  "coverage": {bars(bool), bars_note, bars_window:{symbol,n,first,last}|null,
               metrics: "BTC/USDT"|null, instrument: "XAU/USD"|null, news:{...}|null,
               has_company(bool), has_earnings(bool)},
  "summary":  {…同 /asset 的一行…} | null,
  "by_creator": [{creator_id, creator, units, claims, last_seen, scored, hits, partials, misses, hit_rate}],
  "open_claims":   [{unit_id, horizon_label, quote, payload, published_at, ref_price_at_publish,
                     tags, creator, content_id, content_title}],
  "settled_claims":[{score_id, unit_id, horizon_label, outcome, realized, eval_ts, quote, payload,
                     published_at, ref_price_at_publish, creator, content_id, content_title}],
  "nodes": [{id, kind, title, canonical, status, tags, notes, updated_at, n_attest, n_creators}],
  "disagreements": {
    "relations": [{id, relation, note, a_node, b_node, a_title, a_canonical, a_status, b_*}],
    "evolution": [{node_id, relation, note, node_title, unit_id, quote, published_at,
                   creator, content_id, content_title}]
  },
  "related_assets": [{asset, display, asset_class, co_mentions}],
  "profile": {asset, name, description, industry, exchange, country, currency, cik, homepage,
              logo, listed_on, employees, market_cap, shares_out,
              metrics:{pe_ttm, ps_ttm, pb, eps_ttm, gross_margin, operating_margin, net_margin,
                       revenue_growth_yoy, eps_growth_yoy, roe, beta, high_52w, low_52w,
                       dividend_yield},
              sources:{字段: "polygon"|"finnhub"}, fetched_at} | null,
  "news":   [{id, published_at, title, summary, url, source, provider, image_url,
              relevance: "core"|"context"|null, note: "一句中文"|null}],
  "events": [{asset, kind:"earnings", event_date, session:"bmo|amc|dmh"|null, source,
              payload:{quarter, fiscal_year, eps_estimate, eps_actual,
                       revenue_estimate, revenue_actual}}],
  "trades": [{id, account, symbol, side, status, setup_key, leverage, qty, avg_entry,
              opened_at, closed_at, created_at, outcome, pnl_abs, pnl_pct, realized_r,
              exit_reason}]
}
```

要点：
- `open_claims` 是**时点**列表（按到期日升序），`summary.open_claims` 是**条数**——
  一条判断可以有多个阶梯日，两个数不相等是对的（XAUUSD 实测 23 条 / 32 个时点）。
  `payload.scoring_spec.success_def` 是判据原文，**前端不得截断**；
- `settled_claims` 按判定时点倒序，同一时点按落库次序倒序；
- `disagreements.evolution` 只取 `supersedes`(作者改口) 与 `contradicts`(被反驳) 两种提及——
  这是"信源在这个标的上改过什么口"的载体；
- `related_assets` 来自同一条单元里的共现，不是人工维护的关联表；主题标签（ai-capex 等）
  不会出现在这里，只有登记表里的标的才算；
- `profile` 与 `news` **只对个股与 ETF**（73 个）。`coverage.has_company=false` 的标的
  （指数/贵金属/商品/利率/汇率）两块恒为 `null`/`[]`——**这是"没有公司这回事"，不是"我们没接"**，
  前端据此隐藏这两节而不是渲染空面板。口径与实测结论见 `doc/data/data-gaps.md`；
- `news` 来自 `news_items`（**追加式、可回溯**，按 `(asset, url)` 去重，从不删旧条）；
  加密标的没有 ticker 新闻，回落到 `catalyst_items` 的最新一轮快照（语义不同，`id` 为 `null`）；
- **默认不返回 `relevance='noise'` 的条目**（盘面流水、异动榜单、讲的是别家公司），
  被藏起来的条数在 `coverage.news.noise` 里，页面据此注明"另有 N 条已隐藏"。
  `relevance=null` 表示还没判——降噪是异步跑的，**没跑到之前照常返回**，不会让页面变空。
  `note` 是降噪层给的一句中文（规则判的没有，LLM 判的才有）；口径见 `knowledge/news_triage.py`；
- `profile.sources` 逐字段记来源，某个字段看着不对时能直接查是谁给的；
- `events` 是**财报日历**（`asset_events`，按日期升序，含已公布的实际 EPS）。这张表是
  **upsert** 不是追加——日期会挪、预期会被修正，要的是最新一版；`news_items` 反过来是追加式，
  因为那边要的是"当时报道了什么"。`coverage.has_earnings=false` 的标的（ETF 与指数都不报财报）
  恒为 `[]`；
- `trades` 是评测台在这个标的上开过的仓，**跨账户**。交易库存的是下单时的写法
  （`SOL/USDT` / `BZ` / `NVDA/USDT:USDT` 三种都有过），后端按 `assets.exec_candidates` 宽匹配；
- 价格证据图仍走 `GET /knowledge/prices?symbol=&since=&until=`，本节不重复提供。

---

## 7. 研究档案

### GET /research/docs
`[{name, title}]` 白名单文档索引（capstone / research-log / eval-repositioning / knowledge-engine）。

### GET /research/docs/{name}
`{name, title, path, content(markdown 全文)}` — 前端直接渲染 markdown。

---


## 附录 A：错误与空态目录（常态，前端必须优雅处理）

| 端点 | 常态现象 | 处理建议 |
|---|---|---|
| GET /price | crypto 项长期 `last:null` + `error`（Binance 区域封锁 451） | 行内占位 "—" + tooltip 错误摘要，不整屏报错 |
| GET /watchlist | 响应可能 >5s（逐标的现取） | 骨架 + 较长超时；不放首屏关键路径 |
| GET /metrics | 未采集的 name 返回空数组 | 先查 /metrics/available 决定画什么 |
| GET /trading/positions | 多数时间 `[]`（无持仓） | 空态："当前无持仓。开仓来自扫描/手动/信号。" |
| GET /trading/setups | `signals` 仅指定 account 时非空 | 不传 account 时隐藏信号区 |
| GET /knowledge/spot-checks | 当前 `checked:0` | 空态解释抽查流程（每周人工抽样） |
| GET /knowledge/relations | 仅 6 条边（conflicts 1） | 页面为增长设计，但当下逐条完整呈现 |
| GET /knowledge/nodes | 多数节点无评分聚合（hit/miss=0） | 无评分时不显示 0%，显示"未验证" |
| GET /knowledge/weekly | 现算，1-2s | 骨架；markdown 直接渲染 |
| GET /asset | 长尾标的普遍 `units<10`、`scored=0`、`hit_rate:null` | 不显示 0%，显示"未验证"；n<10 视觉降权 |
| GET /asset/{id} | 指数/金属/利率的 `profile` 恒 `null`、`news` 恒 `[]`（`has_company=false`） | 隐藏这两节；覆盖条写明"没有公司这回事"，不是"未接入" |
| GET /asset/{id} | 美股只有日线，`coverage.metrics` 为 `null`（高频指标只覆盖 5 个加密对） | 覆盖条如实标注，不要拿别的凑 |
| GET /asset/{id} | `display` 可能为 `null`（登记表只对确知的标的填中文名） | 回落显示 id，不要显示"未知" |
| GET /asset/{id} | ETF 与指数的 `events` 恒 `[]`（`has_earnings=false`） | 不渲染财报块 |
| GET /asset/{id} | 多数标的 `trades` 为 `[]`（进场路径只覆盖少数符号） | 隐藏交易节，不留空面板 |
| GET /asset/{id} | **后端比前端旧**（典型：改完代码没重启 uvicorn，响应里没有 news/events/trades） | `isAssetDossier` 在契约层挡下 → 走"读不到档案 + 重试"的可恢复失败态。**放进去会在渲染期抛 TypeError，整页变成"当前页面没有正确载入"**（2026-08-30 实测踩过） |
| 各 claim 的 scores | 85 个时点未到期 → 空数组常见 | 空=「评分待到期（最近时点 YYYY-MM-DD）」 |
| POST /chat*、/trading/open、scan、detect | 同步调 Claude，10s~2min；可能 502 | 等待态 + 明确的失败重试 |
| Postgres 未启动时任意端点 | 500 | 全局错误页："后端数据库未就绪" |

## 附录 B：完整响应样例（真实数据，2026-07-18 采样）

### B1. 内容列表行（GET /knowledge/contents 的元素）
```json
{
  "id": 13, "creator_id": 2, "creator": "美投君", "platform": "youtube",
  "url": "https://www.youtube.com/watch?v=0kvj3lbJqoY",
  "content_type": "video",
  "title": "AI竟与100年前电力革命如此相似？90%的人都看错方向，历史已指明最大商机！",
  "published_at": "2026-07-12T20:00:00+08:00",
  "fetched_at": "2026-07-14T23:32:05.721635+08:00",
  "lang": "zh", "status": "extracted", "raw_len": 13657,
  "n_units": 9, "n_claims": 3, "n_methods": 0, "n_concepts": 6,
  "n_hit": 0, "n_partial": 0, "n_miss": 0
}
```

### B2. claim 单元（含已到期评分；GET /knowledge/contents/{id}/units 的元素）
```json
{
  "id": 32, "run_id": 3, "content_id": 12, "creator_id": 1,
  "published_at": "2026-05-18T20:00:00+08:00", "kind": "claim",
  "quote": "价格呢在周上实际上是突破的，并且有一个小级别的日线级别的回踩确认，这仍然是一个短线多头的一个位置，或者是顺势加仓的一个位置",
  "locator": "10:56", "extractor_version": "pending-v1", "model": "claude-session",
  "payload": {
    "asset_text": "纳指100（28800上方）", "asset_symbol": "NDX", "priceable": true,
    "claim_class": "directional", "direction": "up", "magnitude": null,
    "horizon": {"type": "within_duration", "deadline": null, "duration_days": 7.0},
    "condition_text": null, "condition_observable": false,
    "stance_strength": "explicit", "verifiability": "B",
    "scoring_spec": {
      "method": "sign", "benchmark": null, "eval_ladder": ["2026-05-25"],
      "success_def": "2026-05-25 NDX收盘≥发布参考价29125.3=hit（'短线多头/顺势加仓位'操作化；'短线'→我方7天阶梯）"
    }
  },
  "tags": ["ndx", "price-action"], "ref_price_at_publish": 29125.3,
  "created_at": "2026-07-16T15:16:44.895967+08:00",
  "scores": [
    {"horizon_label": "2026-05-25", "outcome": "hit",
     "realized": {"ref": 29125.3, "ladder": "2026-05-25", "eval_close": 29481.6406}}
  ]
}
```

### B3. method 单元 payload
```json
{
  "name": "长债收益率顶部的两小时反转形态识别",
  "summary": "30年期收益率冲击5%+心理关口时，用两小时级别的高位十字星+向下反包（或破速大阴线）识别干预/反转确认点，确认前不逆势抄底风险资产",
  "family": "event", "testability": "B",
  "rules": [
    "30Y收益率接近或突破5%时观察两小时级别（23/25年两次干预均循此形态）",
    "高位十字星后向下反包大阴线出现=反转/干预确认",
    "确认信号前不逆两小时上涨势能抄底风险资产；让过最低点，不追求抄在最低"
  ],
  "data_requirements": ["30年期美债收益率2小时K线"],
  "claimed_performance": null, "overlap_with_killed": []
}
```

### B4. concept 单元 payload
```json
{
  "canonical_statement": "当前宏观与利率路径不支持美股全面估值扩张，上涨须由盈利驱动（本轮财报盈利强到市盈率反而收缩）",
  "category": "macro_framework", "stance": "assert",
  "regime_qualifier": "2026年高利率环境"
}
```

### B5. 节点详情（GET /knowledge/nodes/5，观点演进样板；attestations 略去一条）
```json
{
  "id": 5, "kind": "concept",
  "title": "AI时代软件收费：席位→按量→按结果",
  "canonical": "企业从无脑冲AI转向严格核算ROI（'输出outcome而非output'）：席位制两硬伤（裁员减席位+token成本自担）使按量收费兴起，但按量只是中间形态、终局=按结果收费（HubSpot被迫转型、甲骨文定价与价值对齐、Palantir为标杆）",
  "status": "corroborated", "tags": ["software", "ai-capex"],
  "notes": "观点演进链：2026-05-31'按量收费是唯一出路'→2026-06-21'按量只是中间形态，按结果是终局'。canonical 取最新表述并保留两硬伤机制（未被推翻）",
  "merger_version": "merge-v1",
  "created_at": "2026-07-17T17:43:27.254893+08:00",
  "updated_at": "2026-07-17T17:43:27.271901+08:00",
  "attestations": [
    {
      "relation": "restates", "note": "首次表述：席位两硬伤+按量=唯一出路",
      "unit_id": 203, "kind": "concept",
      "quote": "第二是在AI Agent时代，token变成了软件公司自己的成本。以前软件公司都是以高毛利著称，多一个人使用软件，几乎不会给公司带来任何新增成本，但是现在不同了，用户使用AI去烧token是要软件公司自己掏钱的",
      "locator": "11:03", "published_at": "2026-05-31T20:00:00+08:00",
      "tags": ["software", "ai-capex"],
      "payload": {"...": "完整 concept payload"},
      "creator": "美投君", "content_id": 17,
      "content_title": "AI是威胁？还是机遇？软件股多点开花预示什么？哪些公司能率先迎来爆发？",
      "scores": []
    }
  ],
  "relations": [
    {
      "relation": "relates",
      "note": "跨源同主题：美投君的收费模式演进论（席位→按量→按结果）与 Andy 转述的投行框架（按算力收费优于席位制）在收费模式命题上交叉印证，但后者是含四要点的复合框架故未归并（见归并裁量）",
      "other_id": 32, "other_title": "投行软件板块共识框架",
      "other_kind": "concept", "other_status": "active"
    }
  ]
}
```

### B6. 关系边（GET /knowledge/relations 的元素，全库唯一 conflicts）
```json
{
  "id": 1, "relation": "conflicts",
  "note": "对立命题（跨源）：Andy 认为半导体已由周期股转为'数字地租'、周期被需求侧突变打破；美投君以 00 年史据认为芯片仍是周期板块、'涨一轮盘整一轮'的周期性涨法仍在。两者不能同真，是两位信源对同一行业性质的根本分歧",
  "created_at": "2026-07-17T18:12:14.665019+08:00",
  "a_id": 10, "a_title": "半导体=数字地租（周期已破）", "a_kind": "concept", "a_status": "active",
  "b_id": 11, "b_title": "芯片板块的周期性涨法", "b_kind": "concept", "b_status": "active"
}
```

### B7. 联赛表（GET /knowledge/scoreboard，全量真实读数）
```json
[
  {"creator_id": 1, "name": "Andy Lee 财经",
   "claims": 104, "d_claims": 18, "methods": 17, "concepts": 46,
   "scored": 51, "hits": 20, "partials": 1, "misses": 30, "cond_not_met": 3,
   "hit_rate": 0.402, "vague_rate": 0.173,
   "sign_n": 25, "sign_hits": 10, "sign_p": 0.212, "sign_side": "below"},
  {"creator_id": 2, "name": "美投君",
   "claims": 31, "d_claims": 14, "methods": 6, "concepts": 43,
   "scored": 5, "hits": 1, "partials": 0, "misses": 4, "cond_not_met": 0,
   "hit_rate": 0.2, "vague_rate": 0.452,
   "sign_n": 4, "sign_hits": 0, "sign_p": 0.062, "sign_side": "below"}
]
```

### B8. 验证档案（GET /knowledge/verifications/62，miss 样板）
```json
{
  "score_id": 62, "unit_id": 34, "horizon_label": "2026-07-17", "outcome": "miss",
  "realized": {"ref": 75.616, "ladder": "2026-07-17",
               "asset_ret": -0.2767, "bench_ret": -0.1204, "eval_close": 55.745},
  "eval_ts": "2026-07-17T15:12:05.271897+08:00",
  "scored_at": "2026-07-17T15:12:05.271916+08:00", "scorer_version": "v1",
  "quote": "它要比黄金震荡更多，并不代表它更弱，从中其来看的话它没有更弱",
  "locator": "07:36",
  "payload": {"...": "完整 claim payload（method=relative_return, benchmark=XAUUSD）"},
  "tags": ["xagusd", "xauusd"],
  "published_at": "2026-05-18T20:00:00+08:00", "ref_price_at_publish": 75.616,
  "extractor_version": "pending-v1",
  "creator_id": 1, "creator": "Andy Lee 财经",
  "content_id": 12, "content_title": "美债会通杀市场吗？金银油、纳指、SOXX关键判断依据。",
  "content_url": "https://www.youtube.com/watch?v=muTemJOTM58",
  "nodes": []
}
```

### B9. 评测账户（GET /trading/accounts 的元素）与交易行（GET /trading/trades 的元素）
```json
{
  "name": "main", "id": 1, "force": false, "managed": true,
  "mirror_of": null, "setups": false, "manual": false,
  "summary": {"balance": 981.7, "initial_balance": 1000.0, "equity": 981.7,
    "used_margin": 0.0, "max_leverage": 10.0, "margin_mode": "cross",
    "default_risk_pct": 1.0, "force_trade": false, "open_positions": []},
  "scorecard": {"account_id": 1, "closed_trades": 3, "win_rate": 0.0,
    "avg_r": -0.741, "expectancy_r": -0.741, "profit_factor": 0.0,
    "total_pnl": -18.3, "max_drawdown": 18.3, "balance": 981.70,
    "avg_exit_efficiency": -2.006, "total_mgmt_contribution_r": 0.315,
    "calibration": [{"bucket": "55-65", "n": 3, "win_rate": 0.0}],
    "decline_accuracy": {"verified": 9, "correct": 5, "accuracy": 0.556}}
}
```
```json
{
  "id": 9, "account_id": 1, "symbol": "ZEC/USDT", "side": "long",
  "strategy_type": "breakout", "leverage": 3.0, "status": "closed",
  "qty": 0.0, "avg_entry": 414.222828, "liquidation_price": null, "margin": 0.0,
  "opened_at": "2026-06-13T15:35:09.366714+08:00",
  "closed_at": "2026-06-13T18:54:21.633127+08:00",
  "created_at": "2026-06-13T15:35:09.250408+08:00", "setup_key": null,
  "pnl_abs": -4.4001, "pnl_pct": -3.6705, "realized_r": -0.595,
  "outcome": "loss", "exit_reason": "sl", "holding_s": 11952.27, "skill_vs_luck": null
}
```

### B10. setup 注册项与聚合行（GET /trading/setups）
```json
{
  "key": "tsmom_7d", "name": "TSMOM 7d（时序动量，7 天回看 → 7 天持有）",
  "hypothesis_ref": "H7", "status": "candidate",
  "symbols": ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
  "risk_pct": 0.5, "leverage": 2.0, "sl_atr_mult": 3.0, "sl_fallback_pct": 10.0,
  "tp_atr_mult": 6.0, "holding_hours": 168.0, "cooldown_hours": 168.0,
  "prior": {"n": 432, "hit_rate": 0.56, "avg_net_return": 0.0128, "ci_low": 0.0044,
    "holding_hours": 168.0, "source": "doc/phase3-H7-tsmom-longhorizon-prereg.md",
    "regime_notes": "全样本 PASS 但两半检验不稳：上半（强下行趋势）+2.15%、下半（方向均衡）-0.27%。只在强趋势 regime 有效，震荡/反转期失效。candidate=仅纸面验证。"}
}
```
```json
{"setup_key": "discretionary", "closed_trades": 10, "win_rate": 0.1,
 "expectancy_r": -0.612, "total_pnl": -42.42, "avg_net_return": -0.0143,
 "avg_bh_r": null, "avg_holding_h": 5.2073}
```
