# trading — 会话须知

交易台的引擎、账本、剧本。**本目录与 `../binance/`、`console/` 归「交易台」会话。**

- 数据落在 `PG_TRADING_CONNINFO` 那个库，与知识库、账户库都不是一回事。
- `worker_trader.py`（包根）是独立进程入口，`deploy/fanisl-trader.service` 目前
  **未在服务器启用**（见 `deploy/README.md`）——交易台前端读的是账本与持仓，
  不依赖这个 worker 在跑。
- 剧本里的 `source` 字段指向 `docs/research/prereg/` 下的预注册文档，阈值锁死不调参。
- 改动后跑 `PYTHONPATH=. python -m pytest tests/test_trading_*.py tests/test_binance_*.py -q`。
