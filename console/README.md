# fanisl console

资产台。与 `frontend/`（知识引擎）同源共存，挂在 `/console/` 路径前缀下——
会话 cookie 因此不必跨站。

## 当前状态

**后端还没写。** 数据全部来自 `src/api/` 下的 mock 层，界面通过右上角的场景
下拉切换成功态与各种失败态。

`src/api/types.ts` 是前后端目前唯一的契约锚点。后端 `/portfolio/*` 落地后：

1. 用 `openapi-typescript` 从 `/openapi.json` 生成类型，替换这份手写的；
2. 把 `src/api/client.ts` 换成 fetch 包装。上层组件只认 `PortfolioSnapshot`，不用改。

## 命令

```bash
npm install
npm run dev          # http://127.0.0.1:5175/console/
npm run typecheck
npm run build
```

## 设计约定

- 绿/红**只**表示盈亏。多空方向用中性徽章加箭头——否则"绿徽章配红数字"要读两遍。
- 数字一律 `.tnum`（等宽 + tabular figures），刷新时不会左右跳。
- 取不到数据时用 `null`，不用 `0`。`0` 是一个有效余额。
- 数据过期时整个数字面加 `.veiled`（降饱和 + 降透明），把"过期"做成可感知的
  材质变化，而不是角落里一行小字。
- 动效只在承载语义处使用：`live` 状态的呼吸点会动，陈旧就静止。金额不做数字滚动。
