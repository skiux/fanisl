# knowledge/ — 知识引擎模块

持续学习、持续验证、持续沉淀投资知识的引擎（定位与分期见 `doc/knowledge-engine-design.md`）。
本 README 是模块地图：文件职责、数据流、常用命令。规范类文档同放本目录：

- `extraction-guide.md` — L1 提取规范 v1（冻结；判断规则 + 期限映射 + 标签受控词表）
- `merge-guide.md` — K5 归并规范 v1（节点判据 + 提及关系 + 生命周期状态规则 + 执行流程）

## 数据流

```
YouTube 频道 ──yt-dlp──▶ 清单+元数据 ──Gemini URL 直读──▶ L0 contents（转录+视觉笔记，不可变）
                                                            │
                        视觉笔记时间戳 ──ffmpeg 流式 seek──▶ keyframes（画面凭据，可重抓）
                                                            │
                              Claude 会话/ClaudeBackend 按 extraction-guide.md 提取
                                                            ▼
                     units JSON ──import_units 校验──▶ L1 knowledge_units（版本化）
                                                            │
                                        K4：评分器按冻结 ScoringSpec 到期机械评分
                                                            ▼
                                                      L2 claim_scores
```

## 文件职责

| 文件 | 职责 |
|---|---|
| `models.py` | L1 单元 pydantic 模型（**schema SSOT**）：KnowledgeUnit 信封 + Claim/Method/Concept 载荷 + ScoringSpec，入库前强校验 |
| `store.py` | 持久化（独立库 `fanisl_knowledge`，8 表 schema 内嵌）：L0 追加式、(content_id, extractor_version) 唯一、版本化重放 |
| `register.py` | 信源登记 CLI：`python -m analyzer.knowledge.register <名称> <平台> <handle>` |
| `sources/youtube.py` | yt-dlp 封装：频道清单、元数据（+字幕白捡；三个已登记频道实测都取不到可用字幕轨）、cookies 注入 |
| `llm.py` | GeminiClient：URL 直读转录（transcript + 带时间戳视觉笔记）、clip 二次细读（start/end offset）、`render_l0_text` L0 排版约定 |
| `transcribe_video.py` | 单视频转录 CLI：`python -m analyzer.knowledge.transcribe_video <handle> <video_id>` |
| `backfill_transcripts.py` | 批量转录回填 CLI（幂等、限速、429/5xx 退避）：`python -m analyzer.knowledge.backfill_transcripts <handle> --since-days 60` |
| `backfill_creator.py` | 单信源历史内容登记辅助 |
| `import_units.py` | L1 单元导入 CLI（PendingBackend 的入库端）：JSON → pydantic 校验 + quote∈原文校验 → record_extraction；`--dry-run` 只验不写 |
| `prices.py` | K4 价格层：daily_bars 表 + SYMBOL_MAP（73 符号，yfinance/FRED；期货代理现货者已注明）：`python -m analyzer.knowledge.prices`（幂等 upsert） |
| `scorers.py` | K4 评分器：按冻结 ScoringSpec 到期机械评分（sign/target_touch/target_close/range_hold/relative_return + 条件解析），`python -m analyzer.knowledge.scorers [--dry-run]`（幂等）；口径细节见模块 docstring |
| `scoring_overrides.json` | success_def 的机械化编译（pending-v1 存量 103 条专用）：条件结构化/判界修正/组合定义，语义仲裁=success_def；新提取应走规范 v2 结构化字段 |
| `nodes.py` | K5 归并层：knowledge_nodes/node_attestations 两表 + 生命周期重算 + CLI（export/import/seed-singletons/recompute/retire），判据见 merge-guide.md |
| `daily.py` | 每日维护封装（行情→评分→节点状态→补齐缺帧，best-effort）：`python -m analyzer.knowledge.daily`；已挂 collector 调度（knowledge_daily_interval_s，默认 86400s） |
| `discovery.py` | K6 发现层：harness 候选（testability=A 的 method 节点，`discovery harness`）+ 周报生成（`discovery weekly [--days 7]`，落 data_export/reports/，collector 每周自动跑） |
| `spotcheck.py` | K6 抽查队列（spot_checks 启用）：`spotcheck sample [n]` 随机抽未查单元 / `spotcheck record <unit_id> <verdict> [note]` / `spotcheck stats` |
| `keyframes.py` | 提帧（ffmpeg 对直链输入级 seek，不下载全片）：`keyframes <video_id> <MM:SS…> [--height 1080]`。客户端梯队 android_vr→tv→ios→web_safari→web，逐个试到解析出流，用了哪个记进 `source`。**2026-08-14 复测已可用**（详见下方"提帧的墙"） |
| `backfill_keyframes.py` | 视觉笔记时间戳 → 关键帧回填/记账（幂等）：`backfill_keyframes [--handle @x] [--content-id N] [--height 1080] [--dry-run]`；`grab_for_content()` 同时挂在摄取链上（transcribe_video / backfill_transcripts 内 best-effort 调用，失败不影响 L0） |

## 日常运转（K4 起；K5 起自动化）

```
python -m analyzer.knowledge.daily      # 行情刷新 → 到期评分 → 节点状态重算 → 补齐缺帧（幂等）
```
collector 进程已按天自动跑（worker_collector 的 knowledge job）；手动跑等价。
分步命令仍可用：`prices` / `scorers` / `nodes recompute`。
新内容入库后的归并：`nodes export` 列未挂单元 → 会话按 merge-guide 判归并 JSON →
`nodes import <file>` → 单例兜底 `nodes seed-singletons`。

K6 起的发现与运营（周报 collector 每周自动跑，其余按需）：
- 关系边（对立/互补，判据 merge-guide §6）：会话判边 JSON → `nodes import-relations <file>`；
- 周报：`discovery weekly`（或 API /knowledge/weekly 现算）；
- 抽查：每周 `spotcheck sample` 抽 10 条人工核忠实度，`spotcheck record` 录结论；
- harness 候选：`discovery harness`（testability=A 的方法节点），立 H 仍走 doc/prereg 人工纪律。
评分 outcome：hit / miss / partial / condition_not_met / condition_unverifiable / unpriceable；
显著性口径：仅 sign 类给 50% 随机基线的单侧二项 p，其余类型 v1 无基线（联赛表已注明）。

## 提帧的墙（会来回动，别把结论钉死）

- **2026-07-16**：yt-dlp 全客户端矩阵 × 有无 cookies 全被 "Sign in to confirm you're not a
  bot" 拦（PO Token 强制，与 IP 无关，用户终端同样被拦）→ 当时判定"提帧不可用"，视觉笔记
  是唯一画面记录。
- **2026-08-14**：复测发现墙已回退，`android_vr` 带不带 cookies 都放行；1080p 单帧约 4s /
  230KB。同时修掉两个自身缺陷：`--height` 的值被当成时间戳解析（IndexError），以及
  `best[ext=mp4]` 只能选到 640×360 的混流 fmt 18（`--height` 形同虚设）→ 改用 DASH 视频轨
  `bv*[vcodec^=avc1][height<=H]`。存量 52 期 1048 帧已回填。
- **墙再起时的梯队**（按顺序试）：① PO Token provider 插件（bgutil，本机 node/deno 可跑，
  无需 Docker）；② Playwright 渲染层截帧（cdn.playwright.dev 现可下载 Chromium；真实浏览器
  指纹不吃 PO Token 那一套，风险是无头截 YouTube 播放可能拿黑帧，需实测）；③ storyboard
  缩略图（320×180，只够存证不够读数）。`keyframes.source` 记着每帧走的哪一级。
- **直链约束**：googlevideo 直链绑发起 IP、约 6 小时过期 → 一期视频的时间戳在同一次解析里
  抓完，直链不入库；帧文件在 `data_export/keyframes/`（gitignore，可按 `keyframes` 表重抓）。

## 约定

- **L0 不可变**：contents.raw 永不改；重转录=新行（dedup_hash 幂等）。
- **画面凭据**：每条视觉笔记配一帧（`keyframes` 表，(content_id, ts_s) 唯一）。笔记是模型对
  画面的转述，帧是凭据——抽查读数忠实度、以及视频被删后的画面留存都靠它，所以**摄取当时
  就抓**，不留到回填。
- **提取可重放**：改规范 → 升 extractor_version → 重跑出新行，旧行保留；同 (content, version) 重跑报错。
- **验证语义冻结在提取时**：评分器只机械执行 ScoringSpec，不做任何现场解释。
- **模型分工**：转录/triage=Gemini（`GEMINI_API_KEY`）；提取=Claude（官方 key 到位前由
  Claude 会话按同一规范产 JSON，走同一校验入库，extractor_version 前缀 `pending-`）。
- 配置：`pg_knowledge_conninfo` / `gemini_api_key` / `youtube_cookies_file`（config.py，
  经 settings 注入——.env 不进 os.environ）。

## 测试

`backend/tests/test_knowledge.py`（payload 校验闸门、store 往返与重放、Gemini 请求组装、
import 解析）。跑法：`cd backend && PYTHONPATH=src .venv/bin/python -m pytest tests/test_knowledge.py`。
