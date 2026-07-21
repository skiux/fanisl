# Fanisl Frontend Rebuild

> 2026-07-21。`doc/api.md` 是数据契约 SSOT。旧前端保留在源码中作为可回退实现，
> 但入口切换到 `frontend/src/vnext/`，不再继续修补旧页面。

## 1. 产品模型

Fanisl 不是按数据库表浏览的后台。前端只围绕六个研究工作流组织：

| 工作流 | 用户问题 | 主要 API 对象 |
|---|---|---|
| Desk | 现在有什么变化，先处理什么？ | weekly、verification queue、relations、collection status |
| Investigate | 一个判断为什么成立，缺什么证据？ | node、unit、content、creator、relation |
| Verify | 一次判断如何被机械裁决？ | verification、prices、scoreboard |
| Markets | 当前数据说明什么，覆盖是否可靠？ | catalog、available、metrics、catalysts |
| Experiments | 哪个 setup 有 edge，实盘是否偏离先验？ | setups、accounts、trades、declines |
| Copilot | 如何基于上述证据继续研究？ | chat stream、conversations |

导航名称是工作动作，不是后端模块名。标签、creator、content、unit 等数据库对象只作为
调查过程中的证据入口，不占主导航。

## 2. 统一对象语法

- L0 原文：来源、发布时间、逐字引用、locator。
- L1 提取：Claim / Method / Concept 的结构化字段与提取版本。
- L2 验证：冻结规则、价格路径、结果、数据问题和基线。
- L3 知识：规范陈述、支持/反对、状态变化、适用范围与证据覆盖。
- L4 研究动作：待核查、待验证、冲突比较、实验候选和下一步。

任何页面最多突出一个主任务。每个状态必须指向原因或证据；百分比必须带样本数；缺失数据
明确显示为覆盖缺口，不以空白、淡字或占位符假装正常。

## 3. 应用结构

- 固定左侧工作流导航：Desk / Investigate / Verify / Markets / Experiments / Copilot。
- 顶部状态栏只放系统健康、数据更新时间和全局命令入口。
- 主工作区使用连续的信息带、队列和证据面板，不使用装饰卡片墙。
- 默认高信息密度；正文与证据可以展开，但关键状态、数字、异常和动作始终可扫读。
- 窄屏把导航折为横向工作流条，内容保持单列优先级，不缩成不可读的小字。

## 4. 迁移顺序

1. **Foundation + Desk**：新入口、工作流导航、状态系统、每日研究队列。
2. **Investigate**：统一搜索、节点调查页、证据链和冲突比较。
3. **Verify**：队列、单次验证档案、价格路径和影响解释。
4. **Markets**：coverage-first 的市场工作台；无覆盖时解释原因而不是显示“指标 0”。
5. **Experiments**：setup、账户、交易和 decline 按实验问题拆分。
6. **Copilot**：保留流式对话，但让回答引用可打开的市场/知识/验证对象。
7. 全部验收后删除旧入口与未引用的旧组件。

## 5. 第一阶段验收

- 运行时不再加载旧 `App.tsx`、旧 Tailwind 页面或旧全局样式。
- 进入任一旧顶层地址时迁移到对应新工作流，不出现空白页。
- Desk 在首屏回答：系统是否健康、需要处理多少项、最新验证如何分布、有什么知识冲突。
- verification、weekly、collection 中任一接口失败时只影响对应区域。
- 没有原生 select、标签瀑布、数据库字段筛选或仅由勾叉组成的验证结果。
- 1440px 与窄屏浏览器实测通过，控制台无错误。
