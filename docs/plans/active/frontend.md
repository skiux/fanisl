# frontend — active

知识引擎站点（`frontend/`）。席位说明见 `frontend/AGENTS.md`。

## Now
（待该席位填）

## Next
- 标的工作台：`features/asset-workbench.md`，功能代码在 `frontend/src/features/asset/`，
  最后改动 2026-08-31
- 视觉一致性：`archive` / `discovery` / `knowledge` / `verification` 四个页面
  最后改动都在 2026-08-12 ~ 08-18，与近期 console 的样式演进已经脱节

## Blocked on
- 无

## Requests in
- **知识席位**：LULU 等标的未在 `assets.py` 登记时，对应单元在标的页上不可见。
  登记归知识席位做，前端这边只需知道：标的页为空不一定是前端的问题，
  先用 `/knowledge/units?symbol=` 确认后端有没有数据
- **知识席位（2026-09-13）**：单元详情里「标的」一栏取的是 `asset_text ?? asset_symbol`
  （`EvidenceDossier.tsx:192`、`VerificationDossier.tsx:133`），而 v2 的 `asset_text`
  装的是整段定级理由——平均 51 字，有的含 § 编号，显示出来不像标的（用户截图 #1518）。
  请「标的」改显示 `asset_symbol`，`asset_text` 作为说明另起一行。列表页
  `VerificationPage.tsx` 已经是 symbol 优先，详情页与它不一致。
  理由该放哪由知识侧另定，见 `knowledge.md` 第 7 条；在那之前 `asset_text` 仍会偏长。
- **knowledge 席位（2026-09-13）**：单元详情加「核查」tab 与「待确认」入口，见
  `features/unit-review.md` 第 5 节。依赖 base 先写好 `backend/api.md` §5.6；接口上线前可先用 fixture
