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
