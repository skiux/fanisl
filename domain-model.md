# DOMAIN MODEL — 知识引擎领域模型

> 前端渲染知识引擎前必读的心智模型：对象是什么、为什么这样设计、如何关联、
> 每个枚举的确切语义与中文标签（本文的映射表是全站文案的 SSOT）。
> 传输结构见 `api.md`，页面组织见 `PRODUCT.md`。

## 1. 流水线：一期视频如何变成一条被市场审计的知识

```
视频发布 ──转录──▶ 内容 content（L0 原文，不可变）
                      │ 会话按冻结规范提取
                      ▼
              知识单元 unit（L1 证据）＝ 判断 claim / 方法 method / 认知 concept
                      │                    │
                      │ 归并（人工判）      │ claim 到期
                      ▼                    ▼
              知识节点 node（可复用知识）   评分 score（L2 市场裁决）
                      │                    │ 写回
                      ├── 提及 attestation（unit→node，带演进关系）
                      └── 关系边 relation（node↔node，对立/互补）
```

关键设计意图（前端呈现时应传达的"产品性格"）：

- **原文不可变，证据逐字**：`unit.quote` 是从转录逐字摘出的引文（入库时机械校验
  必须命中原文），是评分争议时的仲裁依据。渲染引文时不要截断到丢失语义。
- **判据在提取时冻结**：claim 的评分口径（`scoring_spec`）在提取当天定死，评分器
  到期只做机械执行——这防止"事后挑口径"。所以 `success_def` 是一条判断的"合同文本"，
  详情页应完整展示。
- **含糊也入库**：说得含糊（D 级）不是丢弃而是记录——"含糊率"本身是信源质量指标。
- **时点判断不跨时点归并**：黄金下界 4300→4200→4000 是三个独立判断（各自评分），
  不是一条知识的三次重复；只有字面重申（同标的同目标同期限）才归并（如"年底 8200"）。
- **一切百分比都可下钻**：命中率 → 哪些时点 → 每个时点的判据与实价。链断了产品就
  退化成不可信的仪表盘。

## 2. 对象详解

### content（内容，L0）
一期视频的转录全文 + 带时间戳的"画面笔记"（图表读数的文字化记录，因为提帧被墙）。
`raw` 排版约定：正文 + `## 视觉笔记（画面信息，带时间戳）` + `- [MM:SS] (kind) 描述` 行。
`published_at` 是 PIT 锚点（判断以此刻的市场为背景）。

### unit（知识单元，L1）
提取的最小证据单位，三类（`kind`）：

- **claim（判断）**：对未来市场状态的表态。核心字段：
  - 标的：`asset_symbol`（规范符号，如 NDX/XAUUSD）+ `asset_text`（原文表述）；
  - 主张：`direction`（方向）+ `magnitude`（目标/区间/幅度）+ `horizon`（期限）；
  - 条件：`condition_text`（如"站住 4288"）+ `condition_observable`（能否机械判定）；
  - 承诺度 `stance_strength`：explicit（明确立场，含"大概率 X"式单侧承诺）/
    hedged（双向对冲措辞）/ speculative（自标猜测）；
  - **可验证性 `verifiability`**：
    | 级 | 含义 | 有无 scoring_spec |
    |---|---|---|
    | A | 全自动可评（标的、期限、语义都明确） | 有 |
    | B | 可评，但期限是我方阶梯（原文只说"短线/中期"） | 有 |
    | C | 带条件按约定评（前置条件/代理标的/判界系我方） | 有 |
    | D | 不可评（无立场/不可定价/条件不可判） | 无 |
  - `ref_price_at_publish`：发布时参考价（优先取画面笔记里的屏上价）。
- **method（方法）**：可复述的操作规则。`rules[]` 保留原始表述；`testability`
  A=现有数据可回测 / B=缺数据 / C=规则不可机械化；`claimed_performance` 是作者
  自称战绩（**记录不采信**，渲染时须带此语义）。
- **concept（认知）**：可复用的框架/经验规律/量化事实/原则。`canonical_statement`
  是归一化一句话（检索与归并的抓手）；`regime_qualifier` 声明适用环境。

### score（评分，L2）
claim 的一个到期时点（`horizon_label` = eval_ladder 里的日期）的机械判定。
`outcome` 六值（中文标签见 §4）；`realized` 里是判定用的实价（ref/eval_close/
asset_ret/bench_ret 等，随 method 不同）。命中率 = (hit + 0.5×partial) / (hit+partial+miss)，
条件类与不可评类**不进分母**。

评分 method 五种：`sign`（方向对照参考价）/ `target_touch`（期限内触及目标价）/
`target_close`（到期收盘落在目标±2%）/ `range_hold`（判界持续不破，盘中破收回=partial）/
`relative_return`（相对基准的收益差）。

### node（知识节点，沉淀层）
跨内容归并后的规范知识。`canonical` 是当前最完备表述（被 supersedes 时更新为最新版）；
`title` ≤30 字是检索抓手；`notes` 记录归并裁量与演进链（值得展示——它解释了"为什么
这两条是同一个知识"）。**method/concept 全量入节点（单例=1 条提及），claim 仅字面重申
入节点**——所以节点数（105）≈ 方法+认知数（112），claim 主要活在单元层。

生命周期 `status`（自动重算，规则冻结）：
| 状态 | 判定规则 | 语义 |
|---|---|---|
| active | 默认 | 单次提及、未验证 |
| corroborated | ≥2 篇内容提及 | 被重复表达（跨源时更强，看 `n_creators≥2`） |
| verified | 关联评分≥3 时点且加权命中率≥65% | 被市场反复证实 |
| contested | 存在 contradicts 提及，或评分≥3 且命中率≤35% | 被反驳/被市场打脸 |
| retired | 仅人工置位 | 已过时（notes 有理由） |

### attestation（提及）
unit→node 的挂接，`relation` 表达该次表述相对节点命题的关系：
restates（重申）/ refines（细化限定）/ **supersedes（修正取代——作者更新了立场，
节点 canonical 已换成新表述，这是"观点演进"的载体）** / contradicts（否定）。
提及按发布时间排列 = 一条知识的时间演进线（详情页的核心叙事）。

### relation（关系边，发现层）
节点↔节点，无向：
- **conflicts（对立）**：两命题不能同真，且各有独立论证。这是最稀缺的发现
  （当前全库仅 1 条：半导体"数字地租/周期已破" vs "周期性涨法仍在"，恰好跨源）。
- **relates（互补）**：高置信的"读其一应看另一"（问题↔解法、识别↔应对、跨源印证）。
  `note` 必填，写明对立点/关联理由——渲染时 note 是正文不是脚注。

跨源**共识**没有边：它的载体是节点本身的跨源提及（`n_creators≥2`）。

## 3. 三个真实案例（拿它们做设计与开发的样板数据）

1. **字面重申归并**：节点「标普500 2026年底 8200 点」——美投君 6/8 与 7/5 两次
   公开重申同一目标价，两条 claim 归并为唯一的 claim 节点（restates×2），
   评分要等 2026-12-31。
2. **观点演进（supersedes）**：节点「AI时代软件收费：席位→按量→按结果」——
   5/31 说"按量收费是唯一出路"，6/21 修正为"按量只是中间形态、终局按结果收费"。
   canonical 取新表述，notes 记演进链。前端的提及时间线应让这种"改口"清晰可见
   （它是信源诚实度的正面样本）。
3. **市场裁决（miss）**：验证档案 #62——Andy 5/18 称"白银中期不弱于黄金"
   （relative_return vs XAUUSD，60 天阶梯），7/17 到期实测白银 -27.7% vs 黄金 -12.0%，
   判 miss。详情页配价格窗口图（/knowledge/prices?symbol=XAGUSD）可视化这次裁决。

## 4. 枚举 → 中文标签映射（全站文案 SSOT，勿在组件里另起译名）

**unit.kind**：claim=判断 · method=方法 · concept=认知
**verifiability**：A=全自动 · B=我方阶梯 · C=带条件 · D=不可评（口语可说"含糊"）
**stance_strength**：explicit=明确 · hedged=对冲表述 · speculative=试探表述
**claim_class**：price_target=价位判断 · directional=方向判断 · relative=相对强弱 ·
event_outcome=事件结果 · timing=时点判断 · risk_warning=风险警示
**direction**：up=↑ · down=↓ · flat=→ · range=↔ · vol_up=波动↑ · vol_down=波动↓
**score.outcome**：hit=✓ 命中 · partial=½ 部分 · miss=✗ 未中 ·
condition_not_met=条件未触发 · condition_unverifiable=条件不可验 · unpriceable=无价格
**node.status**：active=活跃 · corroborated=多源佐证 · verified=已验证 ·
contested=存在争议 · retired=已退役
**attestation.relation**：restates=重申 · refines=细化 · supersedes=修正 · contradicts=反驳
**relation（边）**：conflicts=对立 · relates=关联
**method.family**：trend=趋势 · reversion=回归 · carry=套息 · event=事件 · flow=资金流 ·
positioning=仓位 · other=其他
**method.testability**：A=可回测 · B=缺数据 · C=不可机械化
**concept.category**：risk_mgmt=风控 · psychology=心理 · market_structure=市场结构 ·
regime=市场环境 · execution=执行 · macro_framework=宏观框架 · other=其他
**content.status**：new=待提取 · extracted=已提取
**交易 outcome**：win=盈 · loss=亏；**trade.status**：planned=挂单 · open=持仓 ·
closed=已平 · cancelled=已撤

## 5. 数字与统计的呈现纪律

- 百分比永远带 n（"42%（51 个时点）"），n<10 时视觉上降权；
- p 值只有方向类判断有（vs 50% 随机基线，单侧二项检验），`sign_side=below` 表示
  劣于随机——如实展示，配 tooltip 解释口径；样本小时 p 无意义，不要用颜色渲染显著性；
- 联赛表当前的真实读数（2026-07-17）：Andy 42%（51 时点，p=0.212）、美投君 20%
  （5 时点）——都不显著，这**符合立项预期**（"首批多数不显著"写在设计文档里），
  文案不须为难看的数字辩解，也不许美化。

## 6. 术语速查

信源=creator（创作者）｜内容=content（一期视频）｜单元=unit（一条证据）｜
节点=node（一条可复用知识）｜提及=attestation｜关系边=relation｜
判据/口径=success_def｜阶梯=eval_ladder（评分时点表）｜参考价=ref_price_at_publish｜
含糊率=D 级占比｜联赛表=scoreboard｜验证中心=verification queue｜
发现=discovery（对立/互补/候选/周报）｜harness 候选=可回测方法清单（流向研究管线）
