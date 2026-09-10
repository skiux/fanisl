# console — 会话须知

交易台（线上挂在 `fanisl.skiuo.com/console/`，独立构建产物）。
知识引擎的站点是另一个应用 `frontend/`。

**本目录与 `backend/fanisl/trading/`、`backend/fanisl/binance/` 归「交易台」会话。**

- features：`auth`、`ledger`（账本）、`orders`、`portfolio`（持仓 / 盈亏 / 风控）
- 这里的 "asset" 指加密钱包里的资产（BTC/ETH），**与知识引擎的「标的」不是一回事**，
  也不要去改 `backend/fanisl/assets.py`——那是知识引擎的标的登记表
- 后端契约以 `../backend/api.md` 为准
- `npm run dev` / `npm run test` / `npm run typecheck`
- `../shared/login/` 两个应用共用，改动会同时影响 frontend
