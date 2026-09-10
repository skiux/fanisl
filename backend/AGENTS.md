# backend — Agent Guide

The Python package lives in `fanisl/` (no `src/` layer). For how to run things
and who owns what, see the repo-root `AGENTS.md`.

## Layout

```
fanisl/
├── config.py db.py runtime.py models.py    shared base: settings / connections / pool wiring / models
├── marketstore.py                          time-series + catalyst storage (read by 23 modules)
├── assets.py                               asset registry (identity) — owned by the knowledge session
├── scheduler.py worker_base.py             background scheduling
├── main.py                                 FastAPI app: /chat plus all query endpoints
├── worker_collector.py worker_trader.py    two process entrypoints
│                                           (module paths are hardcoded in systemd — do not move)
├── collect/    ingest pipeline: metrics(SSOT) → collector → validate → flatten → store
├── chat/       conversational analysis: agent tool loop + prompts + conversation persistence
├── data/       external data-source adapters (yfinance / Polygon / OANDA / FRED / Coinalyze …)
├── knowledge/  knowledge engine K0-K6 — see its README and the two frozen specs
├── trading/    trading-console engine, ledger, playbook
├── binance/    exchange integration: signing, orders, positions, cost basis, daily PnL
├── auth/       login and sessions (deny-by-default ASGI middleware)
├── research/   H1-H22 hypothesis backtests (all adjudicated, dormant;
│               pre-registrations in docs/research/prereg/)
└── indicators/ snapshot/ tools/            indicator computation / snapshot assembly / agent tools
```

Ops scripts live one level up in `backend/tools/`: `check_db`, `check_sources`,
`check_ingest`.

## Hard rules

- **The three databases are not interchangeable:** accounts+conversations
  (`PG_CONNINFO`), trading (`PG_TRADING_CONNINFO`), knowledge
  (`PG_KNOWLEDGE_CONNINFO`). `runtime` opens all three pools at import time, so
  a single missing entry in `.env` can break a page that looks entirely
  unrelated.
- **Entrypoints must go through `runtime`.** `test_db_target.py` uses AST to
  verify that `main`, both workers, and `collect.backfill` import `runtime` —
  that import is the production-database guard. The knowledge CLIs bypass it
  deliberately (extraction writes to the production knowledge DB over the
  tunnel), but they cannot reach account data.
- **Metric changes go through `collect/metrics.py`**, which is the SSOT. The
  propagation checklist is in `docs/data/data-sync.md`; consistency is enforced
  by `tests/test_metrics.py`.
- After any change: `PYTHONPATH=. python -m pytest tests -q` (534 tests).
