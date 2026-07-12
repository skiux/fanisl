# 交易评测改进计划（基于 2026-06-11 数据分析）

> **[已完成/存档]** 本计划已全部落地并入 main（多账户/scorecard v2/影子/拒绝力）。后续演进见 [trading-eval-repositioning.md](trading-eval-repositioning.md)（2026-07 重定位）与 [research-capstone.md](research-capstone.md)。

> **实施状态（branch `trading-improvements`）**：P0/P1/影子/拒绝力校验 + 全仓 + 多账户 + scorecard v2
> + 前端均已落地，backend 155 tests passed、前端 tsc 通过、预览验证通过。剩余：服务器部署、
> 飞轮(C)、数据缺口补齐。逐条状态见各节标注 ✅/⬜。

对应分析见 `trading-eval-analysis.md`。核心心智模型贯穿全部方案：

> **Claude = 提议层**（慢、贵、有判断力），**引擎 = 裁决层**（快、便宜、确定性）。
> 凡是能写成不等式的规则，一律下沉到裁决层；Claude 只负责引擎写不出来的判断。

---

## P0 正确性（直接错账/错执行，先修）

### 1. `partial_exit` 基数错误
- **现状**：`engine.apply_adjustment` 用 `plan["computed"]["qty"] × reduce_pct`（原始数量）；
  Claude 语义是“剩余仓位的 %”。#9 实测“减剩余 50%”被执行成全平。
- **方案**：基数改为 `tr["qty"]`（当前剩余）；`Adjustment.reduce_pct` 的 description 明确
  “按**当前剩余仓位**的百分比”；`MANAGE_SYSTEM_PROMPT` 同步注明。
- **验收**：测试——开仓后连续两次 partial_exit 50%，剩余应为 25%。

### 2. 手动开仓绕过全部容量约束
- **现状**：max_positions / 总在险 ≤5% 只在 `scan()` 检查；`service.open_trade()`（API 手动路径）
  与 `engine.open_trade()` 都不查 → 实测 4 仓并发、8 笔同向。
- **方案**：容量检查抽成 `service._check_capacity(account_id, plan)`，open_trade 与 scan 共用，检查：
  ① 仓位数上限；② 总在险预算；③ **同向净敞口上限**（新增，见 P1-5c）。
  用 PG advisory lock（`account_id` 维度）把「检查 + 开仓」原子化（即此前搁置的并发加固项）。
  超限返回结构化拒绝 `{kind:"rejected", reason}`，前端原样展示。
- **验收**：并发调用 open_trade 不能超过上限；测试覆盖竞态（两个线程同时开第 3 仓）。

### 3. 限价挂单无 TTL、无取消通道
- **现状**：#2 XAG 永久滞留 `planned`；过时论点可能在数天后成交。
- **方案**：
  - `TradePlan` 增加 `entry_ttl_hours: float`（必填，Claude 按结构时效自定，提示词给参考：
    入场周期 15m → 通常 2~8h）；
  - 引擎 cycle 检查 pending 进场单超时 → 撤单、trade 置 `cancelled`、记 `entry_expired` 事件；
  - 新增 API `POST /trading/trades/{id}/cancel`（仅 planned 状态），前端详情页加取消按钮。

---

## P1 评测有效性（决定这个台子有没有意义）

### 4. 强制交易重设计——别再污染主样本
- 主账户**撤销全局 force**，恢复拒绝权（declines 纳入评分，见 6d）。
- force 改为**独立实验账户**的属性：A 账户（自然）/ B 账户（强制）平行跑，
  同一 scan 候选两边各自决策——直接 A/B 出“选择权值多少钱”。
- 如果想保证样本量，主账户用软约束（如“每周低于 N 笔时 scan 降低候选门槛”），而非禁用拒绝。

### 5. 确定性约束全部下沉到引擎（Claude 提议、引擎裁决）
a. **事件封锁**：开仓前查 `catalyst_items` 高影响宏观事件，事件前 `trading_event_blackout_h`
   （默认 12h）内拒绝非 event_driven 计划（或强制 risk 减半 + flag）。数据已在库，纯查询。
b. **TP 可达性校验**：`validate_plan` 增加——TP1 距离 ≤ k × ATR(交易周期) × √(预期持有期/周期)；
   配套 `TradePlan.expected_holding_hours`（必填）。超出 → flag（先记录一阶段，再转 reject）。
   目的：消灭“为凑 RR≥2 画远点”的纸面盈亏比（实测 8 笔 TP 零触达、MFE≤1.38R）。
c. **同向敞口上限**：同方向持仓 ≤2 笔，且同资产类别（crypto/equity/metal）同方向 ≤2；
   后续可升级为相关性分组。6/10 的 4 笔相关空单不再可能。
d. **结构失效价由引擎执行**：`TradePlan` 增加 `invalidation_price: float | None`
   （结构失效位，通常在硬止损内侧）。mark 穿越即引擎**确定性平仓**（exit_reason=
   `thesis_invalidated`），不再等「唤醒 → Claude 复评 → 平仓」的慢回路。
   #7 平在 81.26（计划失效位 81.05、-1.18R）这类延迟损耗消失。Claude 复评只处理
   非价格类信号（OI/资金费/事件）。

### 6. 评测度量补齐（scorecard v2）
a. **MFE/MAE/出场效率**：平仓时由引擎从 snapshots 计算 MFE_R、MAE_R、
   exit_efficiency = realized_r / MFE_R，落 `trade_results` 新列。
b. **自动反事实**：平仓后用 `metric_samples` 价格序列判定“原 SL/TP 谁先到”，
   落 `counterfactual_r`；**管理层贡献 = realized_r − counterfactual_r**，scorecard 聚合展示。
c. **置信度校准**：confidence 分桶（<50 / 50-60 / 60-70 / >70）对比实际胜率；
   前提是 confidence 有方差（见提示词调整）。
d. **declines 评分**：`DeclineDecision` 增加结构化 `recheck_after_hours` + `bias_if_forced`
   （“若必须做会做哪边”）；到期后用价格数据自动判定拒绝质量（拒绝时价 → T+N 价，
   对照 bias 方向），积累“拒绝力”分数。watch_for 保留为文本补充。
e. **基准对照**：见自由发挥的影子账户（比反事实更干净）。

### 7. 复评风暴治理（成本 + 决策质量双收）
- **触发语义改边沿 + 一次性 + 冷却**：
  - `time_elapsed_hours`：一次性检查点，触发后自动失效（现在是电平触发，过 1h 后每拍重触发，
    实测 21 次）；
  - 价格条件：上一拍在另一侧、本拍穿越才触发（边沿）；
  - “逼近止损”带宽：触发后冷却 `trading_reeval_cooldown_s`（默认 30min）；
  - 任何 adjust 之后 grace period 15min 内不再触发。
- **复评上下文瘦身**：manage_context 从 6 周期全量 snapshot 减到 1d + 交易周期 + 入场周期
  三周期 + 衍生品要点；预计单次复评成本减半。
- 预期效果：47 次/2天 → ~15 次，且每次都有新信息（不再是 25/47 的 hold 噪声）。

---

## P2 数据 / 部署 / 运维

8. **部署 + 历史**：服务器部署新代码（3-lane systemd 已备）；行情历史要么服务器跑回填，
   要么 pg_dump 灌本地已回填的 1947→今数据。新一轮评测数据从部署后开始算（规则变了，
   旧 9 笔只做基线参考）。
9. **数据缺口**（已知，不阻塞交易改进）：ETF 流、爆仓历史、社交情绪；宏观 USD 量级元数据；
   basis_perp/DVOL 回填。
10. **前端配套**：详情页加挂单取消按钮；scorecard v2 上新指标（出场效率、管理贡献、
    校准表、拒绝力）；rejected 计划的展示（现在 plan_rejected 只在事件流里）。

---

## 提示词审查结论（逐文件，配套 schema 调整）

整体判断：提示词质量高（数据读法、反证意识、复盘诚实度都在数据里得到了验证），
问题集中在**四个缺失的行为规则**和**一个矛盾激励**上。

### ENTRY_SYSTEM_PROMPT
1. **矛盾激励（最重要）**：“盈亏比一般要 ≥2:1 才值得做”+ TP 无可达性约束 →
   模型为过审把 TP 画远，造成纸面 RR 2~4、实际 MFE≤1.4R、TP 零触达。
   改法：“TP1 必须是预期持有期内**结构上可达**的位置（用 ATR×持有期校验，引擎会核），
   宁可目标近而真实；高胜率结构允许 RR 低到 1.5，低胜率结构才要求更高 RR——
   别用拉远止盈来凑比率。”
2. **置信度校准指引缺失**：实测 8 笔输出 54/54/54/54/54/56/56/61，是常数。
   加锚点：“confidence 会与实际胜率做校准对比；<45 你就不该提交计划、45-55 勉强、
   55-65 良好、>65 强信号。永远写 54 等于不提供信息，宁可偏激被打脸。”
3. **唤醒条件设置指引缺失**：实测价格唤醒线有 0.3R 贴脸的，time≥1h 引发风暴。
   加：“价格唤醒位放在**结构位**（失效/确认位，一般距入场 ≥0.8R），不要设在噪声里；
   time 条件是一次性检查点，设你真正想强制复查的时点（如 24h），不是轮询周期。”
4. **组合视角缺失**：上下文里已有 account.open_positions，提示词从未要求看它。
   加：“开新仓前看 open_positions：与现有持仓同向且相关（同为加密/同受美元流动性驱动）
   是显著的反对理由——你管理的是组合，不是单笔。”
5. force 模式 note 补一句：“强制模式下仍可用 risk_pct 下限（0.25%）表达低信念”，
   把“不情愿”变成连续可观测变量。

### MANAGE_SYSTEM_PROMPT
6. **出场果断性规则缺失**：实测 25/47 复评是 hold，多笔自评“退出偏慢、连续 hold”。
   加：“同一原因第二次被唤醒且没有**新的**支持证据 → 默认减仓或退出；选择 hold
   必须写出‘什么新信息让我留下’，没有就不是 hold 的理由。”
7. **利润保护规则缺失**：#6 浮盈 1.38R 最终只拿 0.24R。
   加：“浮盈 ≥1R 时，把保护（移损到保本/部分兑现）作为默认动作考虑；
   不保护需要明确理由。”
8. **后果明示**：“`thesis_still_valid=false` 会立即市价全平剩余仓位——确认你确实是这个意思。”
9. partial_exit 语义注明“按当前剩余仓位的 %”（配合 P0-1）。

### SCAN_SYSTEM_PROMPT
10. 加组合约束：“候选之间避免同向同类——三个加密空头候选 ≈ 同一笔交易挑了三次。”

### REVIEW_SYSTEM_PROMPT
11. 基本不动（复盘层被数据验证是诚实的）。等 scorecard v2 落库后，把 MFE/MAE/出场效率
    数字喂进 review digest，让“出场时机”评价有数可依。

### models.py（schema 配套）
- `TradePlan` +：`invalidation_price`、`entry_ttl_hours`、`expected_holding_hours`；
  `confidence_pct` description 写入校准锚点。
- `Adjustment.reduce_pct` description 改“当前剩余仓位的百分比”。
- `DeclineDecision` +：`recheck_after_hours`、`bias_if_forced`。

---

## 自由发挥

### A. 影子账户：免费的精确对照组（强烈建议，优先级等同 P1）
反事实回查（6b）只能近似。更干净的做法：每笔真实计划**同时复制到影子账户**，
影子侧纯机械执行（进场、硬 SL、TP 阶梯，全程无 Claude 管理）。
- 每笔交易都有了精确的「无管理对照」——管理层贡献逐笔可算，不靠行情数据近似；
- **零额外 Claude 成本**（影子侧只有引擎撮合）；
- scorecard 直接出「进场质量 =影子结果」「管理增益 = 真实 − 影子」两条曲线。
配合 4 的 A/B 账户，最终矩阵：自然+管理 / 强制+管理 / 自然+无管理（影子），
三层判断力（拒绝力/进场力/管理力）各自隔离可测。

### B. 决策成本进 scorecard
transcripts 已落库，可统计每笔交易消耗的 Claude 调用次数与 token。
两天 83+ 次重决策、25 次结论是 hold，这本身就是被评测对象的缺陷。
建议指标：**R per call**、hold 占复评比例（目标 <40%）。治理复评风暴（7）后跟踪改善。

### C. 复盘 lessons → 规则库的飞轮
现在每笔 review 的 `lessons` 是一次性文本。建议加一张 `lessons` 表：
复盘时让 Claude 额外提交结构化候选规则（如“CPI 前 12h 不开均值回归仓”），
人工审核后把可判定的沉淀为 `validate_plan` 的新检查项。
这个项目最有价值的产出可能不是 PnL，而是这条**从复盘文本到引擎硬约束的转化流水线**——
评测台跑得越久，裁决层越厚，Claude 留给“真判断”的空间越纯。

### D. 实施顺序建议
1. P0 三项 + 提示词/schema 调整（小改动、立即止血）
2. P1-5（引擎裁决下沉）+ P1-7（复评治理）
3. P1-6 scorecard v2 + 影子账户（A）
4. P1-4 多账户 A/B + 部署服务器（P2-8），开始新一轮数据积累
5. 飞轮（C）随复盘数据自然启动
