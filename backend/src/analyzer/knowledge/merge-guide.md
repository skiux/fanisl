# K5 归并规范 v1（merger_version: merge-v1）

> 节点层把散落在各内容里的重复知识归并为**规范知识节点**——可复用性的载体。
> 本文冻结归并判据、提及关系、生命周期状态规则与执行流程；修订须升 merger_version，
> 已有归并不删（attestation 只追加）。表结构 SSOT 在 `nodes.py`。

## 0. 对象与边界

- **method / concept 全量入节点**：每个单元都挂到一个节点（单例=只有一条提及的节点）。
  节点层是耐久知识的检索面；单元层是不可变证据。
- **claim 只归并"重申"**：同标的 + 同目标值/判界 + 同期限口径的字面重申（例：标普年底
  8200 于 6/8 与 7/5 两次给出）。其余 claim 是时点性判断，跨时点归并会破坏 PIT 性质
  （黄金下界 4300→4200→4000 是演进的三个判断，不是一个知识的三次提及），一律留在单元层。
- 归并只在**同 kind 内**进行；跨 kind（如某 method 与其思想的 concept 表述）不合并，
  用节点 notes 互相提及，关系建模留给 K6。

## 1. 同一节点的判据

两个单元归并进同一节点，须全部满足：

1. 同 kind；
2. **同一核心命题**：对相同对象作相同内容的断言——
   - concept：同一机制/原则/框架（"BTC 是流动性指标"两次出现=同一命题）；
   - method：同一操作规则集或其变体（"收益率两小时高位十字星反包"与"两小时大阴线强过
     前阳线"是同一识别方法的两个变体表述→同一节点，rules 并集，notes 记变体）；
   - claim：见 §0 的重申判据；
3. 措辞、例证、时间戳、所在内容不同，不阻碍归并；
4. **宁不合勿错合**：拿不准就不合。相似而命题不同的反例（判据校准用）：
   - "子弹分批打（分批建仓）" vs "降仓等右侧确认" vs "逢高减仓等变盘"——同属仓位纪律，
     但操作命题不同，三个节点；
   - "高位分批止盈切换风格" 与 "了结拥挤筹码分散到防御"——前者讲退出节奏、后者讲
     再配置方向，语境高度重叠时可合（同一实践的两面），在 notes 里写明裁量理由。

## 2. 提及关系（attestation.relation）

- `restates`：重申（默认）——同一命题的再次表达；
- `refines`：细化/限定——加了条件、量化了判界、缩了范围（如"按量收费是唯一出路"
  →"按量只是中间形态、终局是按结果收费"属 supersedes 而非 refines，见下）；
- `supersedes`：修正/取代——作者更新了立场。节点 canonical 更新为**最新表述**，
  notes 记演进链（"2026-05-31 唯一出路 → 2026-06-21 中间形态论"）；
- `contradicts`：同一命题被（同源或跨源）明确否定。节点保留，状态转 contested。
  跨源对立的**不同命题**（半导体"数字地租" vs "周期股涨法"）不是 contradicts——
  它们各自成节点，冲突关系留给 K6 冲突图。

## 3. 生命周期状态（自动重算，规则 v1）

状态是派生量，由 `recompute` 按规则重算（人工只能置 `retired`，重算不覆盖 retired）：

| 状态 | 规则（自上而下首个命中） |
|---|---|
| `retired` | 人工置位（知识已过时/作者撤回且无新证据），notes 必填理由 |
| `contested` | 存在 contradicts 提及；或关联评分时点 ≥3 且加权命中率 ≤0.35 |
| `verified` | 关联评分时点 ≥3 且加权命中率 ≥0.65 |
| `corroborated` | ≥2 条提及来自**不同内容**（跨内容重复；跨信源在 API 里单独标 cross_source） |
| `active` | 其余（单次提及、无验证） |

- 加权命中率 = (hit + 0.5×partial) / (hit+partial+miss)，只数 hit/partial/miss 时点
  （condition_not_met / unverifiable / unpriceable 不计入）；
- 关联评分 = 节点全部 attestation units 的 claim_scores 之并（只对含 claim 的节点有意义）；
- 阈值 3 / 0.65 / 0.35 为 v1 冻结值，改动升 recompute 规则版本并全量重算。

## 4. 执行流程（与 K3 同模式：会话人工判，质量优先）

1. `python -m analyzer.knowledge.nodes export` → 导出待归并单元清单（method/concept
   全量 + claim 全量供重申扫描；含 id/kind/标题行/tags/creator/content）；
2. Claude 会话按本文判据**逐条**分组、定节点 title 与 canonical、标 relation——
   不做相似度批量粗合；canonical 优先沿用单元中最完整的归一化表述（supersedes 取最新）；
3. 产出 nodes JSON（格式见 §5）→ `python -m analyzer.knowledge.nodes import <file>`
   校验入库：kind 一致、unit 存在且未被占用、claim 节点须同 asset_symbol；整文件事务，
   失败全拒；
4. `python -m analyzer.knowledge.nodes recompute` → 重算全部节点状态（幂等，任何时候可跑；
   评分入库后应例行跑，已挂入每日流程）。

新内容持续流入后的常态：新单元先入库（K3 流程）→ 归并会话把新单元挂到既有节点或建新节点
（append-only）→ recompute。

## 5. 导入 JSON 格式

```json
{
  "merger_version": "merge-v1",
  "nodes": [
    {
      "kind": "concept",
      "title": "BTC 是流动性指标",
      "canonical": "BTC 可视为市场流动性指标：BTC 走弱=流动性偏紧信号，对应谨慎对待高风险资产",
      "tags": ["btc", "macro-data"],
      "notes": "跨两期内容重复（c10/c4），表述一致",
      "units": [
        {"id": 43, "relation": "restates"},
        {"id": 150, "relation": "restates", "note": "以'币不抢美元风头'语境重申"}
      ]
    }
  ]
}
```

## 6. 质量规则

- 每个节点的 title ≤30 字、canonical 一句话完备（脱离原文可读）；
- 归并裁量（为什么合/为什么不合）写进 notes——抽查的对象是裁量，不是格式；
- 首批全量归并后随机抽 15 个节点复核：错合（不同命题被合）为最严重缺陷，漏合次之；
- 单例节点不是失败——密度随语料增长，宁可先单例后补挂。
