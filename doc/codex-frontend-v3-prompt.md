# Codex 任务书：Fanisl Frontend V3（知识节点层上线 + 视觉质感整改）

你是资深产品工程师，负责完成 Fanisl（个人金融研究终端）的前端。仓库根目录即工作目录。
后端 FastAPI + PostgreSQL 已就绪（K0–K6 全部完成），前端 React 18 + TS + Vite + Tailwind v3。

## 0. 开工前必读（按此顺序，这是本项目的宪法体系，禁止另起炉灶）

1. `doc/design-philosophy.md` — 产品哲学：四资产/证据链/密度分区/为灰色设计
2. `frontend/DESIGN.md` — 设计语言规范：token/文法/16 条硬规则（R1–R16）。**一切样式决定以此为准**
3. `PRODUCT.md` — 信息架构与地址模型（hash 路由）
4. `doc/ux-audit-2026-07.md` + `doc/frontend-v2-reviews.md` — 已修什么、还欠什么
5. `backend/src/analyzer/knowledge/merge-guide.md` — K5/K6 的领域语义（节点/状态/关系边判据）

规范缺口的处理（DESIGN.md §0）：先补规范文档、再写实现；禁止一次性临时决定。
本任务预期需要增补 DESIGN.md 的一节：**节点生命周期状态的呈现语义**（见任务 A5）。

## 1. 现状诊断（为什么现在"糟糕"——你要修的不是合规性，是质感）

V2 已完成：IA 重排（今日/知识库/市场数据/研究/对话 + ⌘K）、四态取数（空态不说谎）、
字号阶梯、证据链下钻（单元详情=生命线+证据图）。这些**不许倒退**。

但执行贫弱，具体病灶：

1. **K5/K6 零界面**：105 个规范知识节点、生命周期状态、跨源冲突/互补关系边、
   harness 候选、周报、抽查队列——产品最独特的资产在前端完全不可见。
2. **安静做成了空**：Ledger 页在 1440px 宽屏上主栏 44rem + 13rem 侧栏，右侧大片
   无意义空白；侧栏内容瘦弱。要"安静而丰富"：满而不挤，每一屏都有可读的结构。
3. **节奏单调**：所有列表同一种行高与留白，读不出轻重；页题(24)与正文(15)之间的
   17/20 两级几乎没用上；表格是裸的（无列宽设计、无对齐节奏）；图表 margin/tick/
   参考线标签粗糙、会重叠。
4. **细节粗糙**：hover 反馈不一致、baseline 不对齐处多、空态排版随意、
   徽标与正文的字号搭配生硬。

## 2. 硬约束（违反任何一条即返工）

- 设计语言**不可重新发明**：灰阶只用 zinc；彩色只表判决/涨跌（R4）；无阴影（Overlay 除外）；
  无渐变；无入场动画/常驻动画，recharts 一律 `isAnimationActive={false}`；字号只取
  11/12/13/14/15/17/20/24 阶梯（tailwind.config 已映射 text-2xs…text-2xl）。
- 诚实性不可退：数字带 as-of（R1）、比率带样本量（R2）、判决可下钻（R3）、
  loading/error/empty/stale 四态齐全（R11，用现有 `useQuery`+`QueryGate`）。
- **不引入任何新依赖**（无 UI 库/动画库/路由库；hash 路由用 `src/lib/router.ts`）。
- 后端：只许**新增只读 GET 端点**；禁止改 schema、写路径、worker、交易模块。
- 复用原语：`src/market/ui.tsx`（Panel/Statline/Badge/ScoreBadge/Quote/AsOf/QueryGate/CHART）
  与 `src/market/knowledgeUnits.tsx`（三行文法/生命线）。缺构件先在原语层补，页面不得私造。
- 中文文案作证口吻，无 emoji、无感叹号；术语用 DESIGN.md §9.4 表。

## 3. 任务 A：知识节点层上线（主菜，K5/K6 的界面）

后端已有端点（先 curl 看真实形状再写码；8000 端口进程若无这些路由，重启：
`cd backend && PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app --port 8000`）：

- `GET /knowledge/nodes?kind=&status=&tag=&cross_source=&limit=` —
  节点列表，行含 `n_attest/n_creators/n_contents/first_seen/last_seen/hit/partial/miss`
- `GET /knowledge/nodes/{id}` — 节点 + `attestations[]`（relation=restates|refines|
  supersedes|contradicts，每条带 unit 的 quote/locator/payload/creator/content/scores）
  + `relations[]`（该节点的边）
- `GET /knowledge/relations?relation=` — 全部边：conflicts（跨源对立）/ relates（互补），
  note 必填（对立点/关联理由）
- `GET /knowledge/harness-candidates` — testability=A 的 Method 节点清单
- `GET /knowledge/weekly?days=` — 周报 dict（新内容/新单元/新评分/即将到期/新边/抽查覆盖）
- `GET /knowledge/spot-checks` — 抽查覆盖率 + verdict 分布 + 最近记录

节点状态机（merge-guide）：`active → corroborated（多源提及）→ verified（评分支持）
/ contested（被反驳或冲突）/ retired（人工退役）`；attestation 的 supersedes 表示
"新表述取代旧表述"（演进链）。

**A1 节点列表 = 知识库新默认入口**。入口序改为：
`节点 · 时间流 · 判断 · 方法 · 认知 · 标签`（`#/knowledge` 落节点视图，时间流迁至
`#/knowledge/stream`，旧地址做兼容跳转）。列表行三行文法：title（结论行）/
状态戳+kind+n 源 n 提及+时间跨度+评分聚合（口径行）/ canonical 摘要（证据行，可省略）。
支持 status/kind/tag/cross_source 筛选（URL 即状态）。

**A2 节点详情页** `#/knowledge/node/:id`（Reading 容器，对齐单元详情页的文法）：
- 页头：kind 标签行 → title(24px) → canonical 段落 → 口径行（状态戳+推导注记 notes+
  n 源/n 提及/首见~最近+标签链）
- **提及时间线**：attestations 按 published_at 排，每条=左侧时间戳+relation 徽标
  （restates 灰/refines 灰/supersedes 深灰"取代"/contradicts 红"反驳"）+引文块+
  信源+内容链+该 unit 的评分戳（点击进 `#/knowledge/unit/:id`）。这是"知识的可信度
  随证据演化"的可视形态，做扎实。
- 关系区：conflicts 边渲染为**对立命题对照**（两个 title 左右并置 + note 说明对立点，
  中缝"vs"），relates 边为普通引用行。
- claim 类节点若提及带评分：底部聚合一行（n 时点 x✓ y✗，链到各 unit）。

**A3 发现视图** `#/knowledge/discovery`（入口放知识库导航行尾或侧栏）：
- 冲突清单（全部 conflicts 边，对照排版）——"跨源对立是发现不是噪音"；
- 互补簇（relates）；
- **harness 候选表**：Method 节点 + testability + 数据需求 + overlap_with_killed
  （链研究档案对应 H），表尾注脚说明"prereg 仍走人工，候选≠可信"。

**A4 今日接周报与抽查**：今日页新增"本周"区（/knowledge/weekly）：知识增量
（n 内容/n 单元 按 kind）、**即将到期时点**（未来 7 天要开奖的 claim，链单元页）、
新关系边；侧栏系统脉搏下加抽查覆盖行（x% 覆盖，verdict 分布）。

**A5 先补 DESIGN.md**：新增"§9.5 节点与生命周期"小节，定义：状态戳文案与色
（建议：active/corroborated=中性灰阶两档、verified=verdict/hit、contested=verdict/partial、
retired=zinc-300 加删除线感；理由：verified/contested 是证据判决的产物，允许判决色；
其余是过程态，必须灰）；attestation 四关系的徽标文案；对立命题对照的排版规格。
写完这节再动手实现。

## 4. 任务 B：视觉质感整改（逐页，修病灶不换语言）

**B1 Ledger 布局重校**：主栏+侧栏整体在容器内真居中；xl 以上侧栏加宽到 15–16rem
并**充实**（知识库侧栏加：状态分布小结、标签 top8、抽查覆盖；今日侧栏已有战绩+脉搏+
新增抽查）。消灭"右半屏全白"。
**B2 层级三级可辨**：每页必须用出 页题(24)/节题(2xs 大写字距 或 17/20)/条目(15/13)
三级反差；列表行密度按内容分两档（节点/内容流=舒展档，评分流/表格=紧凑档），
同页不混。
**B3 表格精修**：列宽显式设计（数字列定宽右对齐 mono、文本列弹性截断）、表头与首行
间距、行高统一 40px、悬停整行、数字 baseline 对齐。联赛表/计分卡/持仓表全部过一遍。
**B4 图表精修**：统一 margin 与 tick 密度（X 轴 ≤6 tick、Y 轴 4–5）、参考线标签
错位避让、tooltip 用 CHART.tooltip、证据图评估线标签不与目标线标签重叠；
权益曲线与单元证据图高度统一 240px。
**B5 微观对齐清扫**：徽标与结论行 baseline、口径行 `·` 间隔一致（两侧半角空格）、
hover 一律 150ms、可点必 cursor-pointer、focus-visible ring 全覆盖。
**B6 遗留小件**：TradeDetail 页头分层（身份行与结果速览分两行）；复盘面板与委托
记录用留白拉开层级；locator 点击滚动到转录并高亮首个匹配段（做不到精确锚点就
保持展开+滚动，title 如实）。

## 5. 流程与验收（每页走完才算完）

每页流程：Review（对照哲学四问）→ Wireframe（先在 `doc/frontend-v3-reviews.md`
写 10 行内的结构草案）→ Static → API → Animation（=确认无动画）→ Polish。

每页完成后在 `doc/frontend-v3-reviews.md` 记录 Design Review：视觉层级/阅读体验/
信息密度/哲学符合 四项 + 遗留。发现设计问题（规范矛盾/缺口）：停下，把问题与
建议写进该文件的"Design Review 待决"节，**不要自行改规范精神**；缺口类按 §0 补文档。

硬验收（全部通过才提交）：
1. `cd frontend && npx tsc --noEmit && npm run build` 零错误；
2. `cd backend && .venv/bin/python -m pytest -q` 全绿（若加了端点，补对应测试）；
3. 浏览器逐页走查（含 1440×900 与 1920×1080 两档宽度）：每页截图存
   `doc/img/v3/`，控制台零错误；空态/错误态各抽一页实测；
4. DESIGN.md R1–R16 逐条自查，结果写进 reviews 文件；
5. 每屏自问："满而不挤了吗？三级层级可辨吗？灰是主角吗？"任一为否，回到 Polish。

运行环境：后端 `cd backend && PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app
--port 8000`（本机 PG 已就绪）；前端 `cd frontend && npm run dev`（5173，
`VITE_API_BASE` 默认 127.0.0.1:8000）。

## 6. 交付物

代码 + 更新后的 `PRODUCT.md`（新地址：node/discovery/stream）+ DESIGN.md §9.5 增补
+ `doc/frontend-v3-reviews.md`（逐页 review 与 R1–R16 自查）+ 截图目录。
不要求 git commit；如提交，中文 message，不动 doc/prereg 与任何预注册文件。
