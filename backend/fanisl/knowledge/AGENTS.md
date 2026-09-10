# knowledge — 会话须知

知识引擎 K0-K6。**本目录归「知识引擎」会话**，`backend/fanisl/assets.py` 也是。

## 先读

1. `README.md` —— 模块地图：每个文件干什么、数据流、日常运转
2. `extraction-guide.md` —— L1 提取规范 **v2，冻结**。改它必须升 `extractor_version`
3. `merge-guide.md` —— K5 归并规范 v1，同样冻结
4. `../../../docs/knowledge-engine-design.md` —— 分层设计与阶段验收

## 不会变的几条

- **quote 逐字**。导入时机械校验 `quote ∈ 原文`（空白归一后子串），不过就整文件拒绝。
  这是评分争议时唯一的仲裁依据。
- **A/B/C 级 claim 必须当场冻结 ScoringSpec**，D 级不许带（`models.py` 强制）。
  D 的份额本身是信源指标。
- **非价格判断不得机械化成价格 claim**。判别问句：作者有没有说价格会怎样？
- **抽查按批结清**：每批提取完抽满 20%（§10），没抽完不开下一批。
- 五个评分器表达不了的语义（阻力守住、阶梯函数标的的比较符）登记在
  `scoring_overrides.json`，语义仲裁仍以 success_def 为准。

## 常用

```bash
cd backend && source .venv/bin/activate
python -m fanisl.knowledge.backfill_transcripts @yttalkjun --since-days 4   # 摄取（会付 Gemini）
python -m fanisl.knowledge.import_units <file.json> --dry-run               # 只验不写
python -m fanisl.knowledge.scorers --freeze-refs
python -m fanisl.knowledge.spotcheck sample 10
```

摄取由 collector 的 daily 班次自动跑（间隔 24 小时），一期新内容最长可能等约一天。
`backend/tools/check_ingest.py` 只读、不摄取。
