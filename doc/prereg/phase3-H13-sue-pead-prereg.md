# Phase 3 预注册：H13 — SUE-based PEAD（季节性随机游走 SUE，免费 XBRL）

> 跑前写定。2026-06-14。**新 H 编号**。承接 H12 诚实边界：公告反应**符号**是糙代理；真 PEAD 要 **SUE**。
> "想尽办法获取"——绕开付费一致预期，用 **SEC EDGAR XBRL 实际 EPS** 构造 Foster-Olsen-Shevlin 季节性随机游走 SUE。

---

## A. 假设

**用真 SUE（标准化盈利惊喜）替代公告反应符号后，PEAD 在 40 股横截面组合上稳健正、过随机符号门、跨 holdout。**
- SUE = (实际 EPS − 去年同季 EPS) / σ(近 8 季 季节性差)。只需实际 EPS（XBRL 免费深到 2009），不需分析师一致预期。
- 唯一相对 H12 的改动 = **信号从 sign(公告反应) → sign(SUE)**；其余（8-K 精确时点、40 股、季度桶、40 日市场中性、
  随机符号零分布、holdout）全沿用，做**干净对照**：proper SUE 是否优于 return-sign 代理。
- 反面（仍不过）= 连真 SUE 都不行 → 这批大盘股 + 本设定下 PEAD 不可利用（指向需小盘宽 universe 或 decile 强度）。

---

## B. 信号（锁定，禁止调参）

- EPS：XBRL `EarningsPerShareDiluted` 季度（fp Q1-Q3，同 (fy,fp) 取最早 filed=原始），存 eps_q@period_end。
- 事件 = 8-K Item 2.02 公告日 D；匹配"最近已结束季度" = period_end ∈ [D−95d, D−5d] 的最新 eps。
- SUE = (eps_E − eps_{≈E−365d}) / σ(近 8 季 季节性差)；σ≈0 或历史<6 季 → 跳过。
- 方向 d = sign(SUE)；进场 = D+2；市场中性 40 日漂移（个股−SPY）；扣 COST=0.0015。去重叠 25 天。
- PIT：SUE 在公告日 D 即已知（8-K=该季 EPS 发布），季节性/σ 全用过去季；进场 D+2 之后。

---

## C. 分散化 / 切分（同 H12）

- 按入场年-季度分桶（桶内 ≥5 事件），检验桶均值序列。universe = 40 股 + SPY。
- In-sample < 2019-01-01；Holdout ≥ 2019-01-01。

---

## D. 裁决判据（锁死，同 H12，in-sample 桶序列）

1. 桶 ≥ 20。2. mean(桶)>0 且 bootstrap CI下限>0。3. > 随机符号零分布上限。4. >50% 桶为正。5. holdout grand>0。
→ 全过 = SUE 把 PEAD 救活、首个 PASS → Phase 4。→ 否则 KILLED（不挪门）。

## E. 防自欺

1. 阈值全锁；唯一改动是信号（SUE vs return-sign），保证与 H12 可比。
2. 用原始 filed（非重述）EPS；季节性 SUE 只用过去季；8-K 时点 + D+2 进场无未来函数。
3. 随机符号零分布确保赚的是 SUE 方向信息；holdout 真裁判。
4. 探索（不进裁决）：|SUE| 极端三分位子集（PEAD 经典在极端更强）——若主判据边界，作为 H14 线索，不挪 H13 门。
