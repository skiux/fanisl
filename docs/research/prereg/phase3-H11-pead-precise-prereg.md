# Phase 3 预注册：H11 — PEAD 精确版（8-K Item 2.02 精确公告日）

> 预注册：跑前写定。2026-06-14。**新 H 编号**（H9 用 10-Q 备案日粗代理 KILLED，但 full 9/10 标的正、
> 仅"代理太糙"未过 ③）。H11 换**精确盈利公告日**重测——不在 H9 上挪判据。

---

## A. 假设（同 PEAD，精确公告日 + 紧窗口）

**财报盈利公告后，价格沿公告即时反应方向继续漂移 ~40 交易日（市场调整、扣成本后净>0）。**
- 改进点：事件 = **8-K Item 2.02（业绩发布）精确日**（SEC EDGAR `items` 含 2.02），非 10-Q 备案日。
- surprise 窗口收紧到公告前后 **[t, t+1]**（覆盖 AMC/BMO 反应）。
- 反面（净≤0 或 holdout 崩 或仍不过 ③）= PEAD 在这批大盘股 + 单因子 sign 设定下不可利用 → KILLED。

---

## B. 信号（锁定，禁止调参）

- 事件 t = 8-K Item 2.02 备案日（ts=当日 21:00 UTC）。
- 公告后第一根日线 j = ts>事件 的首根（次交易日）。
- **surprise CAR** = 市场调整 Σ(个股−SPY) 日收益，取截至 j 的 **2 个日收益**（即 [t, t+1] 反应窗）。仅用 ≤t+1 数据。
- 方向 d：CAR>0 → long；<0 → short。sign-only。
- **进场 = j+1**（surprise 窗口收盘之后，无未来函数）。去重叠 25 天。

---

## C. PnL / horizon（市场中性）

- 出场 = 进场 + **40 交易日**（主）；+20/+60 记录。
- 净 PnL = `d·[(个股_exit/entry−1)−(SPY_exit/entry−1)] − COST`，COST=0.0015。

---

## D. universe / 切分

- 同 H9：NVDA/AAPL/TSLA/MSFT/META/AMZN/GOOGL/COIN/MSTR/MU + SPY 基准。
- In-sample < 2019-01-01；Holdout ≥ 2019-01-01。判据 in-sample 锁定，holdout 复核 = make-or-break。

---

## E. 裁决判据（锁死；①必过 + ②③④⑤ 在 in-sample）

1. `|S| ≥ 40`。2. `mean>0 且 CI下限>0`。3. `mean > 随机择时零分布上限`。4. 命中>50%。5. ≥60% 标的正。
→ in-sample 全过 且 holdout 净>0 = 候选 → Phase 4。→ 否则 KILLED（不挪门）。

## F. 防自欺

1. 阈值（2 日 surprise 窗 / 40 日漂移 / j+1 进场 / 2019 切分 / COST）锁死；只测顺势一个方向。
2. 精确公告日是相对 H9 的唯一关键改动；若仍不过 ③，说明非"代理"问题，而是单因子 sign-PEAD 在本设定真无可利用 edge。
3. 复权价 + 市场调整剔 beta；holdout 真裁判。
