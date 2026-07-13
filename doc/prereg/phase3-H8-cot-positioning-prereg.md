# Phase 3 预注册：H8 — COT 管理基金持仓极值 → 反转（金/银/油）

> 预注册：判据/信号/切分跑前写定。写定日期：2026-06-14。
> 这是多资产扩张的**第一个切片**（C1 COT），也是**第一次能做真 holdout** 的 H——COT+价回溯到 2006/2008，
> 跨多个 regime，治 crypto 六个 H "单一 regime" 的命门。

---

## A. 假设（可证伪，contrarian 极值反转）

**当某商品的管理基金（投机）净持仓占 OI 比，触及其滚动 3 年分位的极值（≥0.90 拥挤多 / ≤0.10 拥挤空）时，
未来数周价格朝**反方向**回归（拥挤仓位被迫平仓 → 反转），扣成本后净期望为正。**

- 管理基金 = 趋势跟随的投机盘；极端拥挤 = 燃料耗尽、易被挤兑反转。这是 COT-Index 的经典 contrarian 用法。
- 商业（prod_merc+swap，套保盘）作对照变量记录，不进主裁决。
- **诚实声明**：crypto 的 fade 家族（H1/H3/H4）全死。但 COT 是不同市场（商品、周频、有真实套保对手盘、
  发布滞后已知），且有文献支撑的 contrarian 信号。**真正的裁判是 holdout**，不是 in-sample 好看。
- 反面（净≤0 或 holdout 崩）= COT 极值在金银油上也无可利用反转 → KILLED，记录。

---

## B. 信号（精确、机械、锁定，**禁止调参**）

- `mm_net_pct(t) = cot_mm_net(t) / cot_oi(t)`（管理基金净 / 总持仓）。
- 滚动 **3 年**时间加权分位（`pit.tw_percentile_at`，window=1095d，严格只用 ≤t）。
- 极值：分位 ≥ **0.90** → 拥挤多 → fade → **short**；≤ **0.10** → 拥挤空 → fade → **long**。
- **时点**：信号 t = COT 发布时刻（周五，回填已偏移），进场 = t 之后第一根日线。无未来函数。
- 去重叠 = **4 周**（= 主持有，样本不重叠；极值常连续多周）。

---

## C. PnL / horizon

- 出场 = 进场 + **4 周**（主，28d）；+1w/+2w 仅记录。容差 5 天（日线 + 周末）。
- 净方向 PnL = `(ret if long else −ret) − COST`，**COST=0.0010**（金/油期货极流动，往返~10bps；4 周尺度近可忽略，仍计）。

---

## D. universe / 切分

- universe：XAU/USD、XAG/USD、CL（一个 COT 子项目覆盖金银油）。
- **In-sample**：发布时点 < 2019-01-01（约 2009–2018，分位预热后）。
- **Holdout**：≥ 2019-01-01（约 2019–2026）。**判据在 in-sample 锁定，holdout 复核——make-or-break。**

---

## E. 裁决判据（锁死；①必过 + ②③④⑤ 在 in-sample 上）

1. `|S| ≥ 40`。
2. `mean(pnl_S) > 0` 且 bootstrap 单边 95% CI 下限 > 0。
3. `mean(pnl_S) > 随机择时零分布上限`（保留多空配比）。
4. 命中率 > 50%。
5. ≥ 2/3 标的 mean(pnl) 为正。

→ in-sample ①-⑤ 全过 **且 holdout 上 mean(pnl)>0** = **第一个跨 regime 站住的候选** → Phase 4 前向。
→ in-sample 不过，或 holdout 崩 = KILLED（in-sample 好看但 holdout 崩 = 过拟合/regime 依赖，如实记）。

## F. 防自欺

1. 阈值（0.90/0.10、3y、4 周、COST）跑前锁死；只测 contrarian 一个方向。
2. 时点：分位只用 ≤t；COT 用发布时刻（非周二 as-of）；前向只用 t 之后。
3. **真 holdout 是本 H 相对 crypto 诸 H 的最大升级**——in-sample 漂亮但 holdout 崩必须如实判 KILLED，不得挪判据。
4. 商品 COT 不重述，无 vintage 问题；price 为日线收盘（OANDA 金银 / FRED WTI）。
