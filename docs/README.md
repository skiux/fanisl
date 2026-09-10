# doc/ 索引

**前端重写文档四件套在仓库根目录**（2026-07-18 起）：`PRODUCT.md`（产品定义/IA/旅程）·
`domain-model.md`（知识引擎领域模型+枚举中文标签 SSOT）·
`api.md`（60 端点传输契约+真实样例附录）。

```
doc/
├── knowledge-engine-design.md   知识引擎（当前主线）：定位/分层/决定/K0-K7 进度 + 当前状态 + 下一阶段候选
├── project-structure.md         代码结构详解
├── trading-eval-repositioning.md 评测台现役形态（setup 评 edge/闸门/实盘镜像）
├── data/      数据文档：data-gaps(源与缺口) · data-inventory · database · trader-data · data-sync · data-upgrades
├── research/  研究档案（已收官）：research-capstone(总结) · research-log(23 裁决) · project-transformation(蓝图)
├── prereg/    24 份预注册 †判据锁死，永不修改
└── archive/   历史存档（已被取代，仅溯源）
```

**模块内文档约定**（2026-07-16 起）：与实现强绑定的文档直接放模块目录下，doc/ 只放跨模块
的设计与档案。现有模块文档（2026-08-28 复核）：

| 文档 | 管什么 |
|---|---|
| `backend/README.md` | 后端总览：运行、结构、数据采集与持久化、可插拔数据源三步 |
| `backend/src/analyzer/knowledge/README.md` | 知识引擎模块地图：文件职责、数据流、日常运转、运维脚本、提帧的墙 |
| `backend/src/analyzer/knowledge/extraction-guide.md` | L1 提取规范 **v2**，冻结版本化（改它必须升 extractor_version） |
| `backend/src/analyzer/knowledge/merge-guide.md` | K5 归并规范 v1：节点判据、提及关系、生命周期、关系边判据 |
| `deploy/README.md` | 部署与排障全流程 + 自动更新 + 备份 + 本机快照 |
| `deploy/launchd/README.md` | 开发机（macOS）常驻服务；上线后本机 collector/backup 的角色变化 |
| `frontend/README.md` · `console/README.md` | 两个前端各自的工程基线 |

规范类文档（`extraction-guide` / `merge-guide`）与 `prereg/` 一样是**冻结**的：
改判断规则必须升版本号并保留旧版产出，不打补丁。
