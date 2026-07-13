# Phase 3 预注册：H14 — SUE-based PEAD 在小盘 universe（追 live edge）

> 跑前写定。2026-06-14。承接 H13：SUE-PEAD 在大盘 in-sample/full 真显著，但 **holdout 衰减**（大盘被套利）。
> 假说：异象在**小盘**（机构覆盖少、套利不充分）持续性更强 → holdout 仍活。direction(1) 续推。

---

## A. 假设

**同 H13 的 SUE-PEAD，换成 ~75 只小/中盘股 universe 后，桶均值序列显著正、过随机符号门，且 holdout 仍独立成立
（不像大盘那样衰减）。**
- 唯一改动 = universe（大盘 40 → 小盘 ~75）。信号（季节性 SUE）、时点（8-K）、漂移（40日市场中性）、分桶、
  随机符号零分布、holdout 切分全沿用 H13，**不调参**。
- 反面（小盘 holdout 也不独立成立）= PEAD 整体衰减、非仅大盘 → 接受"PEAD 已非可部署 live edge"。

---

## B. 信号 / 切分（全同 H13，锁定）

- SUE = (实际 EPS − ≈去年同季)/σ(近8季季节性差)，XBRL 原始 EPS；事件=8-K Item2.02；进场 D+2；40 日市场中性漂移；扣 15bps。
- universe = backfill_equity.SMALLCAP（回填后实际落地者；survivorship 偏差作 SCREEN 看待）。
- In-sample < 2019；Holdout ≥ 2019。按入场季度分桶（≥5 事件）。

---

## C. 裁决判据（锁死，in-sample 桶序列；**额外强调 holdout 独立性**）

1. in-sample 桶 ≥ 20。
2. mean(桶)>0 且 bootstrap CI下限>0。
3. > 随机符号零分布上限。
4. >50% 桶为正。
5. **holdout 独立成立**：holdout 桶 ≥ 12 且 mean>0 **且 holdout 也过自身随机符号零分布**（比 H13 的 ⑤ 更严——
   H13 仅要 holdout grand>0，H14 要 holdout 独立显著，因为这正是要验证的小盘持续性）。

→ ①-⑤全过 = **小盘 SUE-PEAD 是 live edge** → Phase 4 前向 OOS（第一个可部署候选）。
→ 否则 KILLED：若仅 ⑤(holdout 独立性)不过但①-④过，记"小盘 in-sample 有、holdout 仍衰减"。

## D. 防自欺

1. 唯一改动是 universe；其余全锁，与 H13 严格可比。
2. survivorship：手挑现存小盘有偏；PEAD 是 within-stock 方向效应、市场中性，受影响较小，但结论标 SCREEN，
   真确认靠前向 OOS（前向天然无 survivorship）。
3. ⑤ 升级为 holdout 独立显著，避免"in-sample 好看 + holdout 勉强>0"被当成功（H13 的教训）。
