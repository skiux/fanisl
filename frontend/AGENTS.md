# frontend — 会话须知

**这不是「那个前端」，这是知识引擎的站点**（线上 `fanisl.skiuo.com/`）。
交易台是另一个独立应用 `console/`。两者只共用仓库根的 `shared/login/`。

**本目录归「知识引擎」会话。**

- features：`archive`（研究档案）、`asset`（标的工作台）、`discovery`、
  `knowledge`（L0/L1 浏览）、`verification`（评分与联赛表）
- 后端契约以 `../backend/api.md` 为准；领域概念见 `../docs/DOMAIN.md`；
  产品定义与信息架构见 `../docs/PRODUCT.md`
- `npm run dev` / `npm run test` / `npm run typecheck`；e2e 是 playwright
- `../shared/` 在仓库根，两个应用的 tsconfig 都 include 了它；改那里会同时影响 console
