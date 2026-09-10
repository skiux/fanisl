# docs/ 索引

跨模块的东西放这儿。**只讲一个模块的，回到那个模块里去**——放置规则见
[`CONVENTIONS.md`](CONVENTIONS.md)。会话归属与跑法见仓库根的 [`AGENTS.md`](../AGENTS.md)。

## 常读

| 文档 | 管什么 |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 代码结构详解：三个库、两个产品、每个目录干什么 |
| [`PRODUCT.md`](PRODUCT.md) | 产品定义、信息架构、用户旅程、绝对不要做成什么样 |
| [`DOMAIN.md`](DOMAIN.md) | 领域概念与枚举中文标签的 SSOT |
| [`CONVENTIONS.md`](CONVENTIONS.md) | 语言、文档放哪、注释怎么写、冻结规范怎么改 |
| [`OPERATIONS.md`](OPERATIONS.md) | **日常运营维护**：体检、更新、按症状排障、备份、定期事项 |
| [`knowledge-engine-design.md`](knowledge-engine-design.md) | 知识引擎（当前主线）：定位 / 分层 / K0-K7 进度 |
| [`trading-eval-repositioning.md`](trading-eval-repositioning.md) | 评测台现役形态 |

## 目录

| 目录 | 放什么 |
|---|---|
| [`decisions/`](decisions/) | 技术决策记录（ADR）。写完不改，错了新写一条推翻它 |
| [`plans/active/`](plans/active/) | 在做的事，含在途欠账 |
| [`plans/completed/`](plans/completed/) | 做完的计划，留作对照 |
| [`research/`](research/) | 研究档案（已收官）+ `prereg/` 22 份预注册（判据锁死，永不修改） |
| [`data/`](data/) | 数据层：源与缺口、清单、库结构、同步纪律、付费升级路径 |
| [`archive/`](archive/) | 被取代的历史文档，文首写明被谁取代 |

> `data/` 那几份大多停在 2026-07-13，而数据层这两个月变了不少（90 个符号、
> eps_estimates、daily_bars）。**引用之前先核一遍**，别拿它当现状。

## 模块文档（不在这儿，贴着实现放）

| 文档 | 管什么 |
|---|---|
| `backend/README.md` | 后端总览：运行、结构、采集与持久化、可插拔数据源 |
| `backend/api.md` | 60 端点传输契约 + 真实样例。**合约跟着生产方走，所以不在 docs/** |
| `backend/fanisl/knowledge/README.md` | 知识引擎模块地图 |
| `backend/fanisl/knowledge/extraction-guide.md` | L1 提取规范 **v2，冻结**（改它必须升 extractor_version） |
| `backend/fanisl/knowledge/merge-guide.md` | K5 归并规范 v1，同样冻结 |
| `backend/fanisl/auth/README.md` · `binance/README.md` | 登录 / 交易所对接 |
| `deploy/README.md` | 部署与排障全流程 + 自动更新 + 备份 + 本机快照 |
| `frontend/README.md` · `console/README.md` | 两个前端各自的工程基线 |

各目录另有 `AGENTS.md`（= `CLAUDE.md`，符号链接）写归属与硬规矩。
