# 标的工作台：分阶段实施计划

立于 2026-08-29。目标：把"某个资产标的的决策所需信息"做成一个页面，并补齐它需要的
后端与数据源。本文是执行清单与验收标准，做完一项勾一项；设计依据见文末"背景与判断"。

## 0. 结论先行（三条已定的决定）

1. **前端形态**：`frontend/` 里的第五个路由（`#/asset` 列表 + `#/asset/{id}` 档案），
   **不新起第三个应用**。理由：标的档案的下钻链（标的 → 判断 → 单元详情 → 逐字原文
   → 验证档案）后三跳的组件全在 `frontend/`，分家意味着整页跳转或组件复制。
   `console/` 独立成应用是因为它是另一个数据域（Binance 账户）+ 另一套视觉身份 +
   后端未写，标的页三条都不满足。
2. **后端的真问题不是缺接口，是"标的"这个实体不存在**：系统里有五套互不相认的符号
   命名空间，没有任何一处能回答"NVDA 是什么、我们有它的哪些数据"。这是地基。
3. **IA 需要修订**（PRODUCT.md §5）：标的抬为一级入口。日常使用的姿态是
   "我在看某个标的" 而不是 "我在浏览知识库"，现有以节点为默认入口的组织方式
   在日常使用上不顺手。修订在 P0-8 落地，先于前端开工。

## 1. 命名空间现状（P0 要解决的东西）

| 命名空间 | 例子 | 位置 | 服务于 |
|---|---|---|---|
| instruments canonical | `XAU/USD`、`NDX`、`QQQ` | `data/instruments.py`（25 个） | 行情快照、交易执行 |
| knowledge asset_symbol | `XAUUSD`、`SPX`、`SOXX` | claim payload | 提取、评分 |
| daily_bars symbol | 同上 | `knowledge/prices.py` SYMBOL_MAP（85 个）+ FRED（2 个） | 评分、`/knowledge/prices` |
| metric_samples symbol | `BTC/USDT`、`GLOBAL` | marketstore | 采集、`/metrics` |
| 资产标签 | `xauusd`、`nvda` | units/nodes 的 `tags[]` | 检索 |

**登记表 id 用 knowledge 的 `asset_symbol` 口径**（`XAUUSD` 而非 `XAU/USD`）：它是最大的
命名空间，且不含斜杠——`/assets/{id}` 与 `#/asset/{id}` 都要求 URL 安全。

**设计不变量**：登记表只增加身份信息（名称、类别、别名、跨命名空间的符号映射），
**不改变任何既有符号的语义，不合并两个各自已存有数据的符号**。
例：`GOOG` 与 `GOOGL` 在 daily_bars 里是两条不同的序列（2026-08-27 收 337.71 / 340.65），
登记表把它们记成两个标的并互相关联，绝不合并。别名只用于**入参解析**
（`XAU/USD`/`GOLD` → `XAUUSD`），且别名下不得已有数据。

## 2. 数据现实（2026-08-28 生产库实测，设计必须适配）

98 期内容 / 1122 单元 / 563 节点 / 3 信源；**71 个标的有知识沉淀**。

| 标的 | 单元 | 判断 | 方法 | 认知 | 已判定 | 命中率 | 信源 |
|---|---|---|---|---|---|---|---|
| XAUUSD | 102 | 59 | 11 | 32 | 57 | 46% | 2 |
| SPX | 99 | 41 | 19 | 39 | 21 | 71% | 3 |
| SOXX | 58 | 38 | 12 | 8 | 27 | 59% | 3 |
| NDX | 58 | 39 | 12 | 7 | 23 | 50% | 3 |
| NVDA | 35 | 11 | 0 | 24 | 13 | 62% | 2 |

长尾很长：第 30 名之后普遍 <10 条单元、0 个判定。**页面必须在 102 条与 1 条两端都成立。**

各类数据的覆盖极不均匀，页面必须明写而不是渲染空面板：

| 数据 | 覆盖 |
|---|---|
| `daily_bars` 日线 | 85 符号 + 2 条 FRED 序列 |
| `metric_samples`（41 个 metric） | **只有 5 个加密对** |
| 新闻（`catalyst_items`） | **只有 5 个加密对**，且 replace 语义**无历史** |
| 交易记录 | 8 笔，全加密，与知识库标的几乎零交集 |
| 财报日 / EPS | 代码有（`edgar_source`），**未入库、未接口化** |
| 公司基本信息 | **零**（连标的的中文名都没有） |

---

## P0 · 后端标的身份层（不引入任何外部依赖）— 已完成 2026-08-29

做完 P0，第六节列的 1–6 项页面内容全部可实现，一个新数据源都不需要。

**落地结果**：`assets.py` 登记 97 个标的；`/asset` 对真实快照实测 **71 个标的 / 33 ms**，
`/asset/{id}` **42 ms**；后端测试 288 → **321 passed / 12 skipped**。
语料里出现过的标的**全部**已在登记表内（无未登记缺口）。

**一个必须记住的命名决定**：路由前缀是**单数 `/asset`**。Vite 把前端构建产物放在
`/assets/index-*.js`，API 一旦占用 `/assets`，nginx 会把前端 JS/CSS 代理到 uvicorn、
页面白屏。`deploy/check_nginx_routes.py` 加了两道守护（缺 `asset` 报错、出现 `assets` 报错，
并拿配置里真正那条正则跑 `/asset`、`/asset/NVDA`、`/assets/index-abc.js` 三条路径验证走向）。

### P0-1 `analyzer/assets.py` 标的登记表  — 已完成：97 个标的；`tests/test_assets.py` 11 个用例
- 与 `metrics.py` 同级同性质的 SSOT 登记表（`metrics.py` 是 metric 的，本表是标的的）。
- 字段：`id`（knowledge 口径）· `display`（中文名，新信息）· `en_name` · `asset_class`
  （stock/etf/index/metal/commodity/crypto/rate/fx/preipo）· `aliases[]` · `tag`
  · `yf`（daily_bars 用的 yfinance ticker + 倍率 + 口径备注，None=不采日线）
  · `instrument`（`data/instruments.py` 的 canonical，None=不可路由）· `related[]`。
- 函数：`lookup(any) -> Asset|None` · `resolve_id(any) -> str|None` · `all_assets()`
  · `yf_symbol_map()`（供 prices.py）· `fred_series()`。
- **验收**：新测试 `tests/test_assets.py` —— 别名解析、id 唯一、别名不与任何 id 冲突、
  每个 `instrument` 值都能在 instruments.py 里 lookup 到。

### P0-2 `knowledge/prices.py` 的 SYMBOL_MAP 派生自登记表  — 已完成：派生结果与原 85 项逐条等价，测试里冻了快照
- 去掉一份重复登记；`SYMBOL_MAP` 名字与形状不变（`{sym: (ticker, scale, note)}`），
  scorers/prices CLI 一行不用改。
- **红线**：派生结果必须与今天的 85 项**逐字节等价**——测试里放一份当前快照做断言。
  今天没采日线的标的（HSTECH/INTU，均为 D 级不可评；QQQ/SPY/MSTR 无知识单元）
  在登记表里 `yf=None`，**本阶段不新增日线采集**。
- **验收**：`test_assets.py` 的等价性用例 + 现有 `test_estimates/test_snapshot` 等全绿。

### P0-3 instruments.py 一致性守护（不动路由）  — 已完成：路由一行未改；双向一致性用例已加
- 路由逻辑一行不改（它被 collector/agent/trading 四处依赖）。只加测试：instruments 的
  每个 canonical 都能解析到登记表的一个 id，反向亦然（登记表声明了 `instrument` 的）。
- **验收**：`test_router.py` 现有用例全绿 + 新增一致性用例。

### P0-4 单元过滤器改成"按标的"  — 已完成：`symbol` 现在同时匹配 asset_symbol 与资产标签，别名归一
- 现状：`browse_units` / `browse_units_page` 的 `symbol` 只过 `payload->>'asset_symbol'`
  —— **只匹配 claim**。NVDA 那 24 条认知、SOXX 那 12 条方法一条都出不来。
- 改成 `asset_symbol = X OR tag = lower(X)`，入参先过登记表做别名解析。
- 兼容性：`?symbol=` 参数名保留，语义扩大。当前前端**没有任何地方使用它**（已核），
  改动风险为零；api.md 同步改。
- **验收**：新用例——一条只有 tag 没有 asset_symbol 的 concept 能被 `symbol=NVDA` 取到；
  别名 `symbol=XAU/USD` 与 `symbol=xauusd` 结果相同。

### P0-5 `knowledge/asset_view.py` 聚合读模型  — 已完成：一条 SQL 出全宇宙；`tests/test_asset_view.py` 15 个用例
- `asset_universe(pool)`：一次 GROUP BY 出全部标的的 units/claims/methods/concepts
  计数、已判定数、hit/partial/miss、信源数、首末提及时间。**不许 N+1**。
- `asset_dossier(pool, id)`：单标的档案 —— 计数与战绩（总体 + 按信源拆）、
  未到期判断（从冻结的 `eval_ladder` 反查，同 verification_queue 的口径）、
  已判定记录、相关节点、涉及该标的的关系边、`contradicts`/`supersedes` 提及、
  共同出现的标的（相关标的）。
- **验收**：新测试 `tests/test_asset_view.py`，造 2 信源 × 若干单元 × 若干评分，
  断言计数、命中率口径（hit=1/partial=0.5，条件类不进分母）、未到期反查、相关标的。

### P0-6 `/assets` 与 `/assets/{id}` 端点  — 已完成：实际落为 `/asset` 与 `/asset/{id}`（原因见上）；`tests/test_asset_api.py` 6 个用例
- `GET /assets?all=false` —— 标的宇宙 + 计数 + 数据覆盖标记（有无 bars / metrics /
  news / trades）。默认只返回"至少有一条知识单元"的标的，`all=true` 返回全登记表。
- `GET /assets/{id}` —— 档案聚合（P0-5）+ 身份 + 日线覆盖。
- `GET /assets/{id}/prices` 走已有 `/knowledge/prices`，不重复造。
- **验收**：`tests/test_asset_api.py`（纯函数级，仿 `test_keyframe_api.py` 的做法，
  不起真 app）；本机对生产快照跑一次人工核对。

### P0-7 nginx 路由前缀  — 已完成：含「故意写错能否被拦住」的实测
- `deploy/nginx-fanisl.conf` 的 location 正则要加 `assets`，否则同源生产构建下
  `/assets` 会被 try_files 吞成 index.html（阶段 1 踩过的同一个坑）。
- **验收**：`deploy/check_nginx_routes.py` 通过（它就是为这个坑写的）。

### P0-8 文档（与代码同批提交）  — 已完成：api.md §6 新增 · project-structure · domain-model 新增 asset 对象 · PRODUCT.md §5 IA 修订
- `api.md`：新增 §7 标的，改 §5.2 的 symbol 语义。
- `doc/project-structure.md`：assets.py 与 asset_view.py 入结构图。
- `domain-model.md`：新增"标的"这个对象的定义与它与 claim/tag 的关系。
- `PRODUCT.md` §5 IA 修订：标的抬为一级入口（见本文 §0 第 3 条）。
- `backend/src/analyzer/assets.py` 模块 docstring 写清与 instruments.py 的分工。

---

## P1 · 前端标的工作台 — 已完成 2026-08-29

**落地结果**：`frontend/src/features/asset/`（types / format / AssetPage / AssetDossier /
PriceEvidence / asset.css），路由 `#/asset` 与 `#/asset?id={id}`（详情走 query，与知识库、
验证中心一致），懒加载独立分块 26 kB。
前端测试 10 → **23 passed**；e2e 24 → **30 passed**（两个视口都过，含无横向溢出）；
新增视觉基线 `asset-masthead`（桌面 + 移动）。

**三处必须同时守住 `/asset` 单数**（漏一处就白屏或空数据）：nginx 正则、
`vite.config.ts` 的 preview 代理（**必须用正则键**，字符串键是前缀匹配会吞掉 `/assets/*.js`）、
`e2e/api-fixture.ts` 的路由拦截（精确匹配）。

**对真实数据实测后做的两处调整**（用 2026-08-28 的快照库起本地 API 联调，非 mock）：
① 未到期判断默认只展开最近 6 个到期日、已判定默认 20 条——XAUUSD 全展开时单页高
16 520px，收起后 8 467px；② 价格图的到期日标签按间距抽稀（刻度线全画，密集本身是信息），
XAUUSD 未来 70 天里有 14 个时点，不抽稀会叠成一团黑。

**发现的既有问题（不是本次引入）**：`knowledge-masthead` 与 `verification-masthead` 两个
视觉基线在本机跑不过（宽度差 7px）。已用 HEAD 的干净 worktree 复跑确认与本次改动无关——
是本机新装的 Playwright Chromium 版本与生成基线时的版本不同。要不要整体重做基线是人工决定
（`npm run test:e2e:update`），本次只生成了新增的 asset 基线，没有动那两张。

每一步都跑 `typecheck` + `lint` + `vitest`，整段做完跑 `playwright`。

| 步 | 内容 | 验收 |
|---|---|---|
| P1-1 | 路由与外壳：`#/asset`、`#/asset?id={id}`，导航加"标的"，懒加载分块 | route.test.ts 覆盖新路由；首页包不含标的页主体 · 已完成 |
| P1-2 | 标的列表：按单元数/最近提及排序，带类别过滤与检索 | 71 行全可达；空态文案说明"为什么空" · 已完成 |
| P1-3 | 档案头：身份 + 最新价 + **数据覆盖诚实条** | 覆盖条按真实标记渲染，不假装有数据 · 已完成 |
| P1-4 | **未到期判断 + 到期日历**（最高价值：产品里目前无处回答"什么还没兑现"） | 判据 `success_def` 完整展示，不截断 · 已完成 |
| P1-5 | 战绩：命中率必带 n，按信源拆，样本小降权 | 遵守 domain-model §5 的统计纪律 · 已完成 |
| P1-6 | 价格证据图：daily_bars + 判断标记（目标位/阶梯日/判定） | 复用验证档案已有的画法 · 已完成（并把未到期的阶梯日画进未来区，验证中心没有这个视角） |
| P1-7 | 分歧与改口：conflicts 边 + contradicts/supersedes 提及 | 有边的标的能看到，无边的给解释性空态 · 已完成 |
| P1-8 | 相关标的 + 相关节点 | — · 已完成 |
| P1-9 | 测试：vitest 单元 + playwright 流程 + 视觉基线（1440×900 / 390×844） | 键盘可完成全流程；无横向溢出 · 已完成 |
| P1-10 | 交易记录面板（预期长期为空） | 空态诚实 · **未做**：交易库当前 8 笔且全是加密，与知识库标的几乎零交集，做了就是一块恒空的面板。等 live 账户有实际镜像记录再补 |

**明确不做**：卖方评级与目标价（无源）、社交情绪（付费墙）、给美股铺一整排技术指标
（我们没有日内数据）。PRODUCT.md §4 那条"没有一屏十二个 KPI 卡片"在这一页压力最大。

---

## P2 · 新数据源：公司基本信息与新闻

放在最后是有意的：这两块最可能被频控、被改字段、被封，失败也不影响页面成立。

| 步 | 内容 | 备注 |
|---|---|---|
| P2-1 | `asset_profiles` 表 + Finnhub `/stock/profile2` + `/stock/metric` | key 已在 config（现仅用于加密新闻频道）；字段形状按项目惯例**拿 key 实测核验**后再定 |
| P2-2 | 追加式 `news_items` 表（url 去重）+ 标的关联 | 现有 `replace_catalysts` 是"最新快照"语义，无历史，不能直接用 |
| P2-3 | 按标的的新闻源：Finnhub `/company-news`、Benzinga `tickers=`（现在写死了 `channels=Cryptocurrency`）、Polygon `/v2/reference/news` | 指数/金属/原油没有干净的 ticker 新闻，只能落回关键词检索，质量差一档，页面须标注口径 |
| P2-4 | EDGAR 财报日入库（`fetch_8k_earnings_dates`，已有代码未接产品） | 无 key 无频控，最稳的一块 |
| P2-5 | collector 新车道：按**知识库标的宇宙**迭代，不是 `settings.watchlist` 那 5 个加密对 | 70 个标的按日错峰，注意各源免费档频控 |
| P2-6 | 端点 + 前端接入 + `doc/data/data-gaps.md`、`doc/data/data-sync.md` 更新 | — |

**非股票标的的约束**：XAUUSD / SPX / DXY / WTI / US10Y 没有"公司"，而它们恰好是库里
排名最靠前的标的（前四名里三个是指数或金属）。身份区块必须能退化成
"这是什么工具 + 我们对它有哪些数据 + 相关宏观序列"，**不能按公司页设计**。

---

## 每步的检查动作（不可跳过）

- 后端：`cd backend && ./.venv/bin/python -m pytest -q`（基线 2026-08-29：288 passed / 12 skipped）
- 前端：`npm run typecheck && npm run lint && npm test`，整段做完加 `npm run test:e2e`
- 文档：改了行为就同批改文档，不留"下次补"

## 背景与判断

页面要回答的问题（按决策价值排序，前三项无需任何新数据源）：
1. 库里对这个标的**还有几条判断悬着**、判据是什么、哪天到期；
2. 我的信源在这个标的上**准不准**（带 n，按信源拆）；
3. 他们在这个标的上**哪里分歧、谁改过口**；
4. 价格证据图上这些判断落在哪；
5. 公司/工具是什么（P2）；
6. 最近发生了什么（P2）。
