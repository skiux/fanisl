# console — Agent Guide

The trading console (served at `fanisl.skiuo.com/console/`, built separately).
The knowledge engine's site is a different application in `frontend/`.

**This directory, `backend/fanisl/trading/`, and `backend/fanisl/binance/` are
owned by the trading-console session.**

- Features: `auth`, `ledger`, `orders`, `portfolio` (holdings / PnL / risk)
- "asset" here means a crypto wallet asset (BTC, ETH). **That is not the same
  thing as the knowledge engine's 标的 (tradeable instrument)**, and you should
  not edit `backend/fanisl/assets.py` — that is the knowledge engine's asset
  registry.
- The backend contract is `../backend/api.md`
- `npm run dev` / `npm run test` / `npm run typecheck`
- `../shared/login/` is shared with `frontend/` — editing it affects both
