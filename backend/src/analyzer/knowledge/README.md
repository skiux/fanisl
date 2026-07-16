# knowledge/ — 知识引擎模块

持续学习、持续验证、持续沉淀投资知识的引擎（定位与分期见 `doc/knowledge-engine-design.md`）。
本 README 是模块地图：文件职责、数据流、常用命令。规范类文档同放本目录：

- `extraction-guide.md` — L1 提取规范 v1（冻结；判断规则 + 期限映射 + 标签受控词表）

## 数据流

```
YouTube 频道 ──yt-dlp──▶ 清单+元数据 ──Gemini URL 直读──▶ L0 contents（转录+视觉笔记，不可变）
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
| `store.py` | 持久化（独立库 `fanisl_knowledge`，7 表 schema 内嵌）：L0 追加式、(content_id, extractor_version) 唯一、版本化重放 |
| `register.py` | 信源登记 CLI：`python -m analyzer.knowledge.register <名称> <平台> <handle>` |
| `sources/youtube.py` | yt-dlp 封装：频道清单、元数据（+字幕白捡；两起步频道无字幕）、cookies 注入 |
| `llm.py` | GeminiClient：URL 直读转录（transcript + 带时间戳视觉笔记）、clip 二次细读（start/end offset）、`render_l0_text` L0 排版约定 |
| `transcribe_video.py` | 单视频转录 CLI：`python -m analyzer.knowledge.transcribe_video <handle> <video_id>` |
| `backfill_transcripts.py` | 批量转录回填 CLI（幂等、限速、429/5xx 退避）：`python -m analyzer.knowledge.backfill_transcripts <handle> --since-days 60` |
| `backfill_creator.py` | 单信源历史内容登记辅助 |
| `import_units.py` | L1 单元导入 CLI（PendingBackend 的入库端）：JSON → pydantic 校验 + quote∈原文校验 → record_extraction；`--dry-run` 只验不写 |
| `keyframes.py` | 提帧兜底（ffmpeg 流式 seek）；YouTube player 端点 bot 墙双侧拦死，暂不可用——视觉笔记是当前唯一画面记录 |

## 约定

- **L0 不可变**：contents.raw 永不改；重转录=新行（dedup_hash 幂等）。
- **提取可重放**：改规范 → 升 extractor_version → 重跑出新行，旧行保留；同 (content, version) 重跑报错。
- **验证语义冻结在提取时**：评分器只机械执行 ScoringSpec，不做任何现场解释。
- **模型分工**：转录/triage=Gemini（`GEMINI_API_KEY`）；提取=Claude（官方 key 到位前由
  Claude 会话按同一规范产 JSON，走同一校验入库，extractor_version 前缀 `pending-`）。
- 配置：`pg_knowledge_conninfo` / `gemini_api_key` / `youtube_cookies_file`（config.py，
  经 settings 注入——.env 不进 os.environ）。

## 测试

`backend/tests/test_knowledge.py`（payload 校验闸门、store 往返与重放、Gemini 请求组装、
import 解析）。跑法：`cd backend && PYTHONPATH=src .venv/bin/python -m pytest tests/test_knowledge.py`。
