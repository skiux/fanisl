# frontend — active

知识引擎站点（`frontend/`）。席位说明见 `frontend/AGENTS.md`。

## Now
- **验证页重做**（2026-09-18，用户提的三点：滚动太深、信息太密、说明文字多余）：**整页不滚动**。上面一条判决时间轴
  （以今天为界，命中在上、未中在下，未到期压在轴上），下面一屏卡片是轴上一段的放大镜，轴上高亮标出这一屏的日期，
  可翻「更早 / 更晚」、点轴、键盘或拖动；记录在浮层里看。图例兼作筛选。去掉大标题区、分类说明、「接下来要验证」条、
  页脚标语与旧的独立判定档案页（两栏各自内滚）。经过三版：单栏无限列表 + 原位展开（仍是深度滚动，被否）、
  按屏翻页的列表（被评"敷衍、没有设计感"）、现在这版。用户明确说不参照标的页的布局。
  真实数据实测：1440×900 / 1280×720 / 1024×768 / 390×844 整页可滚动距离都是 0，一屏 9 / 6 / 6 / 3 张卡片；
  最长的 5 条记录在桌面浮层里放得下，手机上浮层内仍要滚 97–157px。**已提交（2026-09-18）、未推送**
- **单元核查前端**（`features/unit-review.md` 第 5 节）：单元详情的「核查」tab 与顶栏「待确认」入口
  已完成，写接口全部在 `e2e/api-fixture.ts` 里按 `api.md` §5.6 的状态机验过。**未对真接口联调**：
  本机 API 连的是生产隧道，写接口不能在本机点；base 这批也还没推送。上线后由用户在站上对一条真实
  单元提交（交接表第 4 步），前端这边再看一次真数据下的样子

## Next
- 视觉一致性：`archive` / `discovery` / `knowledge` 三个页面最后改动在
  2026-08-12 ~ 08-18，与近期 console 的样式演进已经脱节（`verification` 已于 09-18 重做）
- 发现页简报的逐条请求：为挑"重点发现"要逐条取对立边两侧的节点详情（9 条边 = 18 次请求，本机经隧道
  实测最后一个 6.8s 才返回）。请求已写进 `base.md`；接口带上节点计数后改成一次请求
- lint 剩 29 条 warning（2026-09-13 的 HEAD 为 43，09-18 验证页重做后从 34 降到 29），都是 React Compiler 一类的提示（effect 里同步
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
- **已处理（2026-09-17，用户让 knowledge 席位直接改）** knowledge 席位：知识站上去掉按角色区分的地方，所有登录用户一视同仁
  （根 `AGENTS.md` §1，用户定的原则）。实测四处：`UnitReviews.tsx` 的 `canWrite`、
  `frontend/src/shared/navigation/ReviewInbox.tsx` 的 `isAdmin`、`frontend/src/shared/auth/AccountMenu.tsx` 的角色标签与
  「用户管理」入口（用户管理在 console 里）、`reviews.ts` 的注释。接口侧由 base 同步放开；
  与 base 的改动同一个提交。另改了 `e2e/api-fixture.ts`（去掉 403 分支）、`e2e/unit-review.spec.ts`（全部以成员身份跑，
  403 用例换成 409）、`e2e/auth.spec.ts`（以管理员登录也不显示角色）。验收见 `features/unit-review.md` 第 6 节 3c
