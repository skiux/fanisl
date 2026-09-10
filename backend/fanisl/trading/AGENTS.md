# trading — Agent Guide

Trading-console engine, ledger, and playbook. **This directory, `../binance/`,
and `console/` are owned by the trading-console session.**

- Data lives in `PG_TRADING_CONNINFO` — a different database from both the
  knowledge DB and the accounts DB.
- `worker_trader.py` (package root) is a separate process entrypoint.
  `deploy/fanisl-trader.service` is **not currently enabled on the server**
  (see `deploy/README.md`); the console frontend reads the ledger and positions
  and does not depend on that worker running.
- The `source` field in playbook entries points at pre-registration documents
  under `docs/research/prereg/`. Those thresholds are locked — do not tune them.
- After any change:
  `PYTHONPATH=. python -m pytest tests/test_trading_*.py tests/test_binance_*.py -q`
