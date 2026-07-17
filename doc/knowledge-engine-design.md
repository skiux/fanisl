# 知识引擎设计（2026-07-13 定稿，K0 起建；2026-07-16 定位修订）

> 项目第四次测量对象转移：Claude → 用户 → 创作者 → **知识本身**。
> 终局 = 一个**持续学习、持续验证、持续沉淀投资知识的金融知识引擎**。
> **核心资产是知识库本身**——永久积累、可复用、可检索、可验证；验证不是产品而是质检戳
> （让沉淀的知识可信可分辨），信源联赛表只是知识库按作者聚合的一个视图。
>
> 核心循环：获取 → 提取 → 沉淀（归并入库）→ 验证（可验部分打戳）→ 发现（跨源/跨时间
> 新知识）→ 回流入库。"学习" = 知识的可信度随证据演化：每条知识有生命周期状态
> （新入 → 已归并 → 已验证 → 高信任 / 被反驳 / 过时），新内容进来更新的是一批节点的
> 状态，而不只是追加几行记录。
>
> 四属性 → 机制：**永久积累** = L0 不可变 + 版本化提取可重放 + 证据只追加；
> **可复用** = 重复知识归并为规范节点、挂多次提及记录，Method 沉淀为可执行规则；
> **可检索** = 提取时打主题/标的标签，前期 SQL+全文检索，量大后加向量；
> **可验证** = PIT 锚点 + 提取时冻结 ScoringSpec + 机械评分，结果写回知识节点。
>
> 定位依据：LLM 时代"爬内容建库"不稀缺，**带验证战绩、regime 标注、时效记录的知识库**
> 稀缺；持续审计是本项目 23 杀锤炼出的独有能力（纪律 + 多资产时点价格库），在引擎里
> 作为"可验证"属性的执行机构存在。

## 分层

- **L0 原始层**：内容全文/转录 + 发布时刻（PIT 锚点）+ 抓取时刻。**追加式不可变**，
  下游一切可重放。
- **L1 提取层**：三类结构化单元（Claim 可验证判断 / Method 策略规则 / Concept 经验原则），
  信封带 extractor_version——schema 进化后对 L0 重跑出新行，旧行保留。
- **L2 验证层**：Claim 到期按**提取时冻结的 ScoringSpec** 机械评分（零 LLM），配随机符号
  基线；Method 严选进研究 harness；Concept 记共识/争议度不评分。
- **L3 沉淀层**：去重归并（规范知识节点 + 提及记录）、生命周期状态、冲突图、regime 条件化、
  假设生成。归并从 K5 起步（不是"后期"——可复用性靠它），图谱是表示选择，
  **先扁平库+标签+引用链，出现图状查询需求再升**。
- **L4 应用层（后期）**：信源联赛表（视图）、观点面板、知识问答、playbook 候选。

## 关键设计决定

1. **验证语义前置**：Claim 的可验证性分级（A 全自动/B 期限系我方阶梯/C 带条件按约定/
   D 不可评但入库——含糊率本身是信源指标）与 ScoringSpec 在提取时一次性冻结，评分器只做
   机械执行。字段定义见 `knowledge/models.py`（即 SSOT）。
2. **模型分工**：L0 triage（及后期转录）= Gemini flash（GEMINI_API_KEY）；L1 提取 =
   `LLMBackend` 接口：ClaudeBackend（官方 key，后配即启用）/ **PendingBackend（过渡期：
   内容排队，由 Claude 会话批量提取，经同一入库校验）**。两种产出只差 extractor_version，
   官方 key 到位后重跑对照即得校准集。
3. **三个注册表**保持可拓展：抓取器按平台注册、评分器按 ScoringSpec.method 注册、
   LLM 按 backend 注册。
4. **独立库 `fanisl_knowledge`**：七张表（creators/creator_handles/contents/extraction_runs/
   knowledge_units/claim_scores/spot_checks），只向外读 pit/stats/marketstore/instruments。
5. **质量回路**：每周随机 20 条人工抽查提取忠实度（spot_checks）；发布时刻记"平台声称 +
   我方抓取"双时间，差距过大降级。

## 分期与状态（2026-07-16 修订：按"18 条跑通一遍"重排，历史回填后置）

| 期 | 内容 | 对应属性 | 状态 |
|---|---|---|---|
| K0 | 库/表/models/store/登记 CLI/测试 | — | ✅ 2026-07-13 |
| K1 | 抓取（YouTube 清单+元数据；字幕实测两频道全无 → 改判） | — | ✅ |
| K2 | Gemini URL 直读转录+视觉笔记（双频道实测可靠；提帧被 bot 墙双侧拦死 → 视觉笔记为唯一画面记录）；批量回填器落地，近 60 天 18 条 / 15.7 万字入库 | 积累 | ✅ 2026-07-15 |
| K3 | **提取+沉淀**：提取规范冻结（四类知识平权、期限映射、标签体系，见 `knowledge/extraction-guide.md`）→ import 管线（quote∈原文机械校验）→ 试提取 2 条人审通过 → **18 条全提取 ✅ 2026-07-16**：247 单元（claim 135 = 3A/65B/35C/32D，method 23，concept 89），标签 52 个，claim 带屏价 ref 78/135；语料教训回写规范（屏价须与正文互证、stance=承诺度非语气词） | 积累、检索 | ✅ |
| K4 | **验证**：daily_bars 价格层（39 符号 yfinance/FRED，与语料屏价互验）+ scoring_overrides（103 条 success_def 机械化编译，质量核心）+ 评分器×5（含条件解析/守护条件/组合腿）+ scoreboard API + 前端联赛表与单元评分徽标；**首轮 60 时点评分 ✅ 2026-07-17**：Andy 命中率 42%（sign 类 10/25，p=0.212 不显著）、美投君 5 条 1 hit；日常=prices+scorers 两条幂等 CLI 按天跑 | 可验证 | ✅ |
| K5 | **归并与检索**：knowledge_nodes/node_attestations 两表 + 归并规范冻结（`knowledge/merge-guide.md`：判据/提及关系 restates·refines·supersedes·contradicts/生命周期规则 v1）+ 首次归并 ✅ 2026-07-17：**105 节点**（9 个多提及：K型经济跨源、软件收费 supersedes 演进、8200 重申等；94 单例种子；数字地租 vs 周期涨法对立标注留 K6）+ 每日维护挂 collector 调度（daily.py）+ nodes API×2（前端接线留前端会话） | 复用、学习 | ✅ |
| K6 | **发现 v0 ✅ 2026-07-17**：节点关系边（`node_relations`，判据 merge-guide §6，人工判：首批 1 条跨源对立"数字地租 vs 周期涨法"+5 条高置信互补）+ 共识视图（nodes API cross_source 过滤）+ harness 候选清单（testability=A 方法节点×4：EMA 隧道/股金比/AUDJPY 锚/大摩油价系数，立 H 仍走 prereg 人工纪律）+ 周报生成器（markdown 落盘+API 现算，collector 每周自动）+ 抽查队列启用（spotcheck sample/record/stats）；API：/knowledge/relations、/harness-candidates、/weekly、/spot-checks | 发现 | ✅ |

后续轴线（跑通后按需启动）：历史回填（往前 6-12 个月，为验证提供成熟 claim 密度）、
信源扩张（2 → 5-8 个，刻意配风格：宏观/技术/个股基本面/加密——单一风格 claim 相关性高，
合成观点无增量；按联赛表淘汰补新）、向量检索、图谱按需升、假设生成与评测台对接。

起步信源（2026-07-13 登记）：Andy Lee 财经（youtube @andyleegogo）、美投君（@MeiTouJun）。
语料实读结论（2026-07-16，18 条）：Andy Lee = 价位条件型，每期 8-12 个可评判断 + 真 Method
（EMA 隧道体系），对冲措辞浓 → B/C 为主，含糊率信息量大；美投君 = 宏观论题型，claim 少而净
（含 A 级样本"标普年底 8200 点"），Concept/经验规律密度高（存量/增量逻辑框架、Zillow 领先
12-18 个月等）。视觉笔记抓到屏上最新价 → **ref_price 首选屏价**（比 pit.asof 更贴近创作者
说话时点，且覆盖我方未采集资产）。
预期管理（立项即写死）：首批联赛表大概率"多数不显著、少数显著为负"——这是结果不是失败，
反技能名单与含糊率同样是产出。

## 视频摄取决定（2026-07-13，实测后改判）

起步两频道（@andyleegogo/@MeiTouJun）实测**无任何字幕轨**（manual/auto 均空）→ 字幕路径降为
"有则白捡"，**主通道 = Gemini 以 YouTube URL 直读视频**（file_data 传 URL，含音轨+画面）：
1. 一次调用产出：全文转录 + **带时间戳的视觉笔记**（画面中图表的标的/周期/标注价位/表格数字
   的结构化描述）——关键帧的**信息**以文字形式进 L0，不提像素。
2. 提取层需要细看某段时，用 video_metadata 的 start/end offset 做 **clip 二次细读**（只看那
   几十秒），全程不下载视频。
3. 真需要图像的兜底（低优先）：YouTube storyboard 缩略图（免下载、低清）或 ffmpeg 流式 seek
   抓单帧（几 MB 级）。风险如实记：视频被删则画面信息只剩文字化记录——所以摄取时视觉笔记做厚。
   **提帧攻关记录（2026-07-16，暂搁置）**：yt-dlp 全客户端矩阵×cookies 全被 bot 墙拦
   （PO Token 强制，非 IP 问题）；可行出路=Playwright 浏览器渲染层截帧（真实浏览器指纹
   不受 PO Token 限制），受阻于 Chromium 下载被掐+系统无 Chrome，细节见
   `backend/src/analyzer/knowledge/README.md`。用户决定：先留着，K4 优先。
4. yt-dlp 职责收窄为：频道清单 + 元数据（标题/时长/发布日期）+ 有字幕时白捡。
   cookies 经 settings.youtube_cookies_file 注入（.env 不进 os.environ，已修）。
5. 文字源（文章/帖子）不经转录直接入 L0 → Claude 提取；Gemini 只做廉价 triage（前期量小可跳过）。
