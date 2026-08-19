# fanisl console

资产台。与 `frontend/`（知识引擎）同源共存，挂在 `/console/` 路径前缀下——
会话 cookie 因此不必跨站。

## 当前状态

**后端还没写。** 数据全部来自 `src/api/` 下的 mock 层，右上角可切换场景。

`src/api/types.ts` 是前后端目前唯一的契约锚点，字段按 Binance 实际接口对齐：

| 契约字段 | 数据来源 |
|---|---|
| `wallets` | `GET /sapi/v1/asset/wallet/balance` 六个钱包的分布 |
| `spot` | `POST /sapi/v3/asset/getUserAsset` 四种锁定态 |
| `futures` | `GET /fapi/v2/account` + `/fapi/v1/accountConfig` |
| `futures[].liq_distance` | 由 `/fapi/v1/leverageBracket` 的维持保证金率推得 |
| `earn` | `GET /sapi/v1/simple-earn/{flexible,locked}/position` |
| `margin` | `GET /sapi/v1/margin/account` |
| `income` | `GET /fapi/v1/income`（资金费 / 已实现 / 手续费） |
| `transfers` | `GET /sapi/v1/capital/{deposit/hisrec,withdraw/history}` |
| `equity_curve` | `GET /sapi/v1/accountSnapshot`（最多 30 天日快照） |

后端 `/portfolio/*` 落地后：用 `openapi-typescript` 从 `/openapi.json` 生成类型
替换本文件，再把 `src/api/client.ts` 换成 fetch 包装。上层组件只认
`PortfolioSnapshot`，不用改。

## 命令

```bash
npm install
npm run dev          # http://127.0.0.1:5175/console/
npm run typecheck
npm run build
```

## 设计约定

- **绿/红只表示盈亏。** 多空方向用中性徽章加箭头；充提在瀑布图里用黄铜色——
  钱转进来不是赚的，染成绿色会被读成盈利。
- **数字一律 `.tnum`**（等宽 + tabular figures），刷新时不左右跳。
- **取不到用 `null`，不用 `0`。** `0` 是一个有效余额。
- **降级按来源分组，不是按整页。** 451 打在 fapi 上只带走合约与收支流水，
  现货、理财、日快照照常显示；每一节自己知道数据是不是真的。
- **归因算不出来就空着。** 恒等式
  `期末 = 期初 + 净充提 + 已实现 + 未实现变动 + 资金费 + 手续费`
  缺任一项就不闭合，与其给对不上账的图不如不给。
- **过期做成材质**（`.veiled` 降饱和降透明），不是角落一行小字。
- **动效只在承载语义处出现**：`live` 呼吸点会动，陈旧就静止；金额不做滚动动画。
- 字号音阶 11 / 12.5 / 14 / 15 / 17 / 21 / 27 / 40，相邻比值 1.15–1.30，
  层级靠字重与颜色，不靠尺寸跳跃。
