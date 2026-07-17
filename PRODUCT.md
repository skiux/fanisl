# Fanisl PRODUCT.md — 产品信息架构（IA 备忘 v2）

> 2026-07-17（第二轮更新）。本文是 `doc/design-philosophy.md` §5 的落地备忘 +
> `doc/ux-audit-2026-07.md` 的执行清单，随实现同步演进；与 `frontend/DESIGN.md`
> （视觉与组件规范）配套。冲突时优先级：philosophy > 本文 > DESIGN.md。

## 1. 空间与导航

顶层导航五项（顺序即优先级），默认落点 = 今日：

```
今日 · 知识库 · 市场数据 · 研究 · 对话        ＋ ⌘K 全局寻址（随处可唤起）
```

## 2. 地址模型（hash 路由，无新依赖）

| 地址 | 对象 |
|---|---|
| `#/today` | 今日 |
| `#/knowledge` | 知识库 · 时间流（`?creator=`） |
| `#/knowledge/browse` | 跨内容单元浏览（`?kind=claim|method|concept&tag=&symbol=&creator=`） |
| `#/knowledge/tags` | 标签枢纽 |
| `#/knowledge/unit/:id` | **单元详情**（生命线 + 证据图 + 评分明细 + 冻结口径） |
| `#/knowledge/content/:id` | 内容阅读页 |
| `#/data` | 市场数据（`?symbol=&metric=&cat=`） |
| `#/research` | 研究（`?account=`） |
| `#/research/trade/:id` | 单笔交易详情 |
| `#/research/archive[/:name]` | 研究档案（capstone / 23 裁决 / 重定位 / 知识引擎设计） |
| `#/chat` | 对话 |

## 3. 页面职责

- **今日**：头版=新到期评分流（`/knowledge/recent-scores`，判决是每天的新闻）；
  次之=新入库内容；侧栏=信源战绩快照+系统脉搏（stale 如实标注）。
  仍缺：知识状态变化流（K5 生命周期落地后）。
- **知识库**：同一批对象的**五个入口**——时间流 / 判断 / 方法 / 认知（跨内容浏览，
  `/knowledge/units`）/ 标签（`/knowledge/tags` 枢纽）；单元详情页是证据链下钻落点：
  三问（出处/口径/结果）一页闭环，证据图按 DESIGN.md §8 判决叠加（`/knowledge/prices`
  读 daily_bars）。联赛表=侧栏视图，窄屏降级主栏后置。
- **市场数据**：证据基底单页仪器；分类=筛选；URL 即状态。
- **研究**：头版=setup 计分卡；账户概况 Statline；实盘录入（唯一写入口）；
  已关实验操作=页尾折叠；**研究档案**在产品内陈列（`/research/docs` 白名单只读，
  与 doc/ 同源）。
- **⌘K**：对象寻址——导航/信源/标签/内容标题/指标/单元全文（后端 ILIKE）。
- **对话**：工具位。

## 4. 连接规则（引用跟随）

- 评分戳 / 单元结论行 → 单元详情；单元详情 → 内容阅读页 → 原视频外链；
- 单元标签 → 标签浏览；联赛表行 / 信源名 → 该信源筛选；
- method 的 `overlap_with_killed` → 研究档案（裁决日志）；
- 今日条目 → 单元详情 / 阅读页；交易行 / 信号流 → 交易详情。
- 断链规则不变：数据在库但端点缺失 → 普通文本 + 注记，不做假链接
  （现存唯一断链:claim `ref_price` 不跳市场数据——知识资产多为美股/商品，
  不在 metric_samples 覆盖内；证据图已直接呈现 daily_bars，此链不再必要）。

## 5. 本期不做（改动先修订本文）

K5 规范节点页与生命周期状态流、K6 共识/冲突视图、向量检索、暗色主题、
移动端专项优化、对话区组件重写、locator→转录精确锚点（当前=展开原文）。

## 6. 后端读端点（第二轮新增，均只读）

`/knowledge/tags` · `/knowledge/units`（kind/tag/symbol/creator/q 过滤）·
`/knowledge/units/{id}` · `/knowledge/recent-scores` · `/knowledge/prices`
（daily_bars 窗口）· `/research/docs[/{name}]`（doc/ 白名单陈列）。
