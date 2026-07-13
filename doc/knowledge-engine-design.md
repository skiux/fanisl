# 知识引擎设计（2026-07-13 定稿，K0 起建）

> 项目第四次测量对象转移：Claude → 用户 → 创作者 → **知识本身**。
> 终局 = 一个**被市场数据持续审计的金融知识引擎**：持续获取金融创作者的图文/视频，
> 提取其观点/策略/经验为结构化单元，**获取与验证同体**（发布时刻冻结、到期机械评分），
> 积累到密度后再做知识归并、假设生成（L3/L4）。
> 定位依据：LLM 时代"爬内容建库"不稀缺，**带验证战绩、regime 标注、时效记录的知识库**稀缺；
> 持续审计正是本项目 23 杀锤炼出的独有资产（纪律 + 多资产时点价格库）。

## 分层

- **L0 原始层**：内容全文/转录 + 发布时刻（PIT 锚点）+ 抓取时刻。**追加式不可变**，
  下游一切可重放。
- **L1 提取层**：三类结构化单元（Claim 可验证判断 / Method 策略规则 / Concept 经验原则），
  信封带 extractor_version——schema 进化后对 L0 重跑出新行，旧行保留。
- **L2 验证层**：Claim 到期按**提取时冻结的 ScoringSpec** 机械评分（零 LLM），配随机符号
  基线；Method 严选进研究 harness；Concept 记共识/争议度不评分。
- **L3 合成层（后期）**：去重归并、冲突图、regime 条件化、假设生成。图谱是这层的表示选择，
  **先扁平库+标签+引用链，出现图状查询需求再升**。
- **L4 应用层（后期）**：信源联赛表、观点面板、知识问答、playbook 候选。

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

## 分期（K0-K5）与状态

| 期 | 内容 | 状态 |
|---|---|---|
| K0 | 库/表/models/store/登记 CLI/测试 | ✅ 2026-07-13 |
| K1 | 抓取（YouTube 清单+元数据 ✅ 2026-07-13；字幕路径实测两频道全无字幕→改判） | ✅ |
| K2 | Gemini URL 直读（llm.py/transcribe_video CLI/keyframes 提帧）**代码✅ 2026-07-13**；运行验证移交用户终端（沙箱出口 IP：Gemini 403 区域拒绝、YouTube 流媒体端点 bot 墙，webpage/元数据可过） | 🟡 |
| K3 | 提取管线 + PendingBackend 会话工作流 + ref_price 打戳 | ⬜ |
| K4 | 评分器×5 + 每日到期任务 + 随机基线 + 信源联赛表（API+前端） | ⬜ |
| K5 | 周报心跳 + 首批历史回填与提取 + 抽查队列 | ⬜ |

起步信源（2026-07-13 登记）：Andy Lee 财经（youtube @andyleegogo）、美投君（@MeiTouJun）。
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
4. yt-dlp 职责收窄为：频道清单 + 元数据（标题/时长/发布日期）+ 有字幕时白捡。
   cookies 经 settings.youtube_cookies_file 注入（.env 不进 os.environ，已修）。
5. 文字源（文章/帖子）不经转录直接入 L0 → Claude 提取；Gemini 只做廉价 triage（前期量小可跳过）。
