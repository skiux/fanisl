# Phase 3 预注册：H15 — 小盘 SUE-PEAD 用 IWM 对冲（修正 H14 size 污染）

> 跑前写定。2026-06-14。H14（小盘 SUE-PEAD，SPY 对冲）KILLED 且为负——识别出方法学硬伤：
> **用大盘 SPY 对冲小盘股，残留 size 因子**（小盘 vs 大盘），2019-2026 小盘跑输把结果拖负，与 PEAD 无关。
> H15 修正：换**小盘基准 IWM（罗素2000 ETF）**对冲，正确剥离小盘市场，留纯个股 PEAD。

## A. 假设
**小盘 SUE-PEAD 在用 IWM 正确对冲后，桶均值显著正、过随机符号门、holdout 独立成立。**
- 唯一相对 H14 改动 = 基准 SPY→IWM。其余（SUE 信号、8-K 时点、40 日漂移、~75 小盘池、分桶、零分布、2019 切分）全锁。
- 反面（IWM 对冲后仍非正）= H14 的负**不是** size 污染，小盘 SUE-PEAD 真不成立 → KILLED（结论更硬）。

## B. 判据（锁死，同 H14）
①in-sample 桶≥20 ②grand>0且CI下限>0 ③超随机符号零分布 ④>50%桶正 ⑤holdout 独立显著(桶≥12、>0、过自身零分布)。
→ 全过 = 首个可部署候选 → Phase 4 前向。→ 否则 KILLED。

## C. 防自欺
1. 唯一改动是基准（修正 specification error），不是事后挑参数找显著——SPY 对小盘本就是错基准。
2. IWM 复权日线 Yahoo 回填（2010+，无 key）。survivorship 同 H14（SCREEN，前向无偏）。
3. 若 in-sample 翻正但 holdout 仍不独立 → 仍 KILLED（PEAD 整体衰减），不挪门。
