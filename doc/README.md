# doc/ 索引

**前端重写文档四件套在仓库根目录**（2026-07-18 起）：`PRODUCT.md`（产品定义/IA/旅程）·
`domain-model.md`（知识引擎领域模型+枚举中文标签 SSOT）·
`api.md`（50 端点传输契约+真实样例附录）。

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
的设计与档案。现有模块文档：`backend/src/analyzer/knowledge/README.md`（模块地图）、
`backend/src/analyzer/knowledge/extraction-guide.md`（L1 提取规范，冻结版本化）。
