# frontend — active

知识引擎站点（`frontend/`）。席位说明见 `frontend/AGENTS.md`。

## Now
- **单元核查前端**（`features/unit-review.md` 第 5 节）：单元详情的「核查」tab 与顶栏「待确认」入口
  已完成，写接口全部在 `e2e/api-fixture.ts` 里按 `api.md` §5.6 的状态机验过。**未对真接口联调**：
  本机 API 连的是生产隧道，写接口不能在本机点；base 这批也还没推送。上线后由用户在站上对一条真实
  单元提交（交接表第 4 步），前端这边再看一次真数据下的样子

## Next
- 视觉一致性：`archive` / `discovery` / `knowledge` / `verification` 四个页面最后改动在
  2026-08-12 ~ 08-18，与近期 console 的样式演进已经脱节
- 发现页简报的逐条请求：为挑"重点发现"要逐条取对立边两侧的节点详情（9 条边 = 18 次请求，本机经隧道
  实测最后一个 6.8s 才返回）。请求已写进 `base.md`；接口带上节点计数后改成一次请求
- lint 剩 34 条 warning（2026-09-13 的 HEAD 为 43），都是 React Compiler 一类的提示（effect 里同步
  setState 等），不影响运行。改到哪个页面顺手清哪个，不单独开一轮

## Blocked on
- **base**：`/knowledge/relations` 带两侧节点计数（见上）
- **等用户定**：两份跨模块文档里前端相关的内容已过期，都在 `docs/` 顶层、席位表没覆盖
  （base 已把 `docs/` 顶层列为无主），frontend 不改：
  - `docs/ARCHITECTURE.md` 的"前端"一节写的是重建前的旧前端（ChatView、`market/pages`、Tailwind、recharts），
    现在一样都不存在
  - `docs/PRODUCT.md` 引用旧文件名 `api.md` / `domain-model.md`（现为 `backend/api.md` / `docs/DOMAIN.md`）；
    §7 数据规模停在 2026-07-18（18 篇 / 247 单元，2026-09-13 实测 115 篇 / 1542 单元）

## Requests in
已处理（2026-09-14）：
- knowledge：单元详情「标的」改显示 `asset_symbol`，`asset_text` 以「标的说明」另起一段完整显示。
  请求点名的两处之外，判定档案待执行视图与内容页的单元标题行也改了
- knowledge：核查 tab 与待确认入口，见 Now
- base：`frontend/AGENTS.md` 的归属说明已改为"接口变更请求写进 `base.md`"
- **knowledge 席位（2026-09-17）**：知识站上去掉按角色区分的地方，所有登录用户一视同仁
  （根 `AGENTS.md` §1，用户定的原则）。实测四处：`UnitReviews.tsx` 的 `canWrite`、
  `frontend/src/shared/navigation/ReviewInbox.tsx` 的 `isAdmin`、`frontend/src/shared/auth/AccountMenu.tsx` 的角色标签与
  「用户管理」入口（用户管理在 console 里）、`reviews.ts` 的注释。接口侧由 base 同步放开；
  base 上线前 member 点提交仍会拿到 403。验收见 `features/unit-review.md` 第 6 节 3c
