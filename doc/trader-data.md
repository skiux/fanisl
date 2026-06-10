# fanisl 交易评测台 · 数据清单

更新于 2026-06-10。交易台用**独立库 `fanisl_trading`**（与行情库 `fanisl` 分离）。本文列出每张表
存什么、谁写、怎么用。行情/衍生品等"输入数据"见 [data-inventory.md](data-inventory.md)。

设计原则：**过程 > 结果**。最值钱的是「Claude 每次决策时看到的数据 + 它的结构化判断」被冻结留痕，
事后能审计"判断对错 vs 运气好坏"。客观结果由引擎算，Claude 不给自己打分。

---

## 数据流（一笔交易的生命周期 → 落到哪些表）

```
扫描/指定标的
  └─ Claude 进场决策 ── decline ─→ declines（不交易也是评测样本）
        │ plan
        ▼
   引擎校验+预登记 → trades(一行) + trade_plans(v1) + decision_inputs(entry, 冻结输入)
        │ 撮合
        ▼ 持仓中（引擎驱动）
   每 15s ─→ position_snapshots(盯市帧) ；事件 ─→ trade_events
   触发唤醒 → Claude 重评 → trade_plans(v2,v3…) + decision_inputs(reeval) + orders(加/减/移止损)
        │ 平仓
        ▼
   trade_results(引擎客观结果) + decision_inputs(review) + trade_reviews(Claude 复盘)
```

---

## 表逐张说明（库 `fanisl_trading`）

### `accounts` — 虚拟账户
`initial_balance` / `balance`（现金）/ `max_leverage` / `margin_mode` / `default_risk_pct` /
`force_trade`（强制交易开关）。权益=现金+浮盈亏（引擎实时算，不落表）。

### `trades` — 一笔交易（持仓主体）
`symbol` / `side`(long/short) / `strategy_type`(trend/mean_reversion/breakout/event_driven/carry) /
`leverage` / `status`(planned→open→closed/cancelled) / `qty` / `avg_entry` / `liquidation_price` /
`margin` / `opened_at` / `closed_at`。

### `trade_plans` — **版本化**计划（Claude 的进场判断 + 每次调整）
`version` / `is_active` / `plan`(JSONB)。`plan` 里含 Claude 提交的结构化字段 + 引擎算出的执行参数：
- **决策依据**：`thesis`(一句话理由)、`mtf`(大/交易/入场周期 + 是否共振)、`macro_context`、
  `risk_events`、`regime`(趋势/震荡)、`risk_appetite`、`confidence_pct`(主观胜率，用于校准)。
- **交易计划**：`entry_type/price/trigger`、`risk_pct`、`sl_price/sl_basis/sl_type`、
  `tp_targets`[{price,reduce_pct}]、`leverage`。
- **唤醒条件** `wake_conditions`[{type,value,note}]：Claude 自声明在何条件下被引擎唤醒重评
  （price_above/below、pnl_pct_above/below、time_elapsed_hours）。
- **引擎算的** `computed`：qty / margin / rr(盈亏比) / liquidation_price / risk_amount。
- 调整版还带 `adjustment`(action + reason)。

### `decision_inputs` — **冻结的决策输入**（评测的根）
`kind`(entry/reeval/review) / `plan_version` / `inputs`(JSONB，Claude 当时看到的多周期快照+催化剂等) /
`prompt` / `response`(Claude 完整 content blocks，含思考/工具往返)。**这是不可重建、最该存的素材**。

### `orders` — 委托与成交
`kind`(entry/add/reduce/sl/tp/exit) / `price` / `qty` / `fee` / `status`(pending/filled/cancelled) /
`actor`(engine/claude/user) / `reason` / `placed_at` / `filled_at`。

### `position_snapshots` — 持仓盯市时序（引擎每 15s 写）
`ts` / `mark` / `qty` / `avg_entry` / `margin` / `upnl`(浮盈亏) / `dist_sl` / `dist_tp` /
`liq_price` / `holding_s`。前端「持仓实时状态」面板读它。

### `trade_events` — 统一事件时间线
`ts` / `kind`(opened / needs_review / adjust_* / *_fill / tp / sl / liquidation / closed …) /
`actor` / `payload`。前端时间线读它；也是审计 Claude 被唤醒/动作的依据。

### `trade_results` — 引擎客观结果（平仓时一行）
`pnl_abs` / `pnl_pct`(相对初始保证金) / `realized_r`(实际盈亏/计划风险额) / `planned_r`(计划盈亏比) /
`holding_s` / `exit_reason`(tp/sl/liquidation/manual/thesis_invalidated/time_stop) /
`outcome`(win/loss/breakeven) / `fees`。

### `trade_reviews` — Claude 复盘（平仓后）
`review`(JSONB)：`plan_adherence`(纪律) / `discipline_violations`[] / `entry_timing` / `exit_timing` /
**`skill_vs_luck`**(判断对×赚/判断对×亏/判断错×赚/判断错×亏 四象限) / `skill_vs_luck_note` / `lessons`。

### `declines` — 不交易记录（避免过度交易的评测样本）
`symbol` / `reason` / `watch_for` / `inputs`(冻结) / `transcript`。

---

## 派生：评测打分卡（`scorecard`，按需聚合，非表）

由 `trade_results` 聚合：`closed_trades` / `win_rate` / `avg_r` / `expectancy_r`(期望R) /
`profit_factor`(盈利因子) / `total_pnl` / `max_drawdown` / `balance`。
**判断力要看分布，不是单笔**——样本少时这些数字只是噪声。

---

## API（前端/外部取数）

`GET /trading/account`(账户+打分卡) · `GET /trading/trades`(列表) · `GET /trading/trades/{id}`(完整
时间线：trade/plans/orders/snapshots/events/result/review) · `GET /trading/positions`(实时持仓) ·
`GET /trading/declines` · `POST /trading/open`(指定标的让 Claude 评估) · `POST /trading/scan`(自主扫描)
· `POST /trading/tick`(手动推进一拍) · `PATCH /trading/account/force`(强制交易开关)。

---

## 现状与缺口

- **已完整记录**：进场/调整的结构化判断 + 冻结输入、版本化计划、盯市时序、客观结果、技能/运气复盘、
  不交易样本。评测闭环跑通。
- **缺口/可加**：① 概率**校准曲线**（把 `confidence_pct` 与实际兑现率对比，量化"自信是否靠谱"）；
  ② **基准对照**（同期买入持有/随机进场，判断 Claude 是否有真实边际）；③ 账户**权益曲线**落表
  （现在权益实时算、不留历史）。这三项是把"评测"做扎实的下一步。
