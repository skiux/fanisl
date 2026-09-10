# backend — 会话须知

Python 包在 `fanisl/`（没有 `src/` 层）。跑法与归属见仓库根的 `AGENTS.md`。

## 布局

```
fanisl/
├── config.py db.py runtime.py models.py        共用底座：配置 / 连接 / 三池装配 / 模型
├── marketstore.py                              时间序列与催化剂的存储层（被 23 处共读）
├── assets.py                                   标的登记表（身份）——归知识引擎会话
├── scheduler.py worker_base.py                 后台调度
├── main.py                                     FastAPI app：/chat + 全部查询接口
├── worker_collector.py worker_trader.py        两个进程入口（模块路径写死在 systemd，别挪）
├── collect/    采集管线：metrics(SSOT) → collector → validate → flatten → 写库
├── chat/       对话式分析：agent 工具循环 + prompts + 对话持久化
├── data/       外部数据源适配器（yfinance / Polygon / OANDA / FRED / Coinalyze …）
├── knowledge/  知识引擎 K0-K6 —— 见其 README 与两份冻结规范
├── trading/    交易台的引擎、账本、剧本
├── binance/    交易所对接：签名、订单、持仓、成本、日盈亏
├── auth/       登录与会话（默认拒绝的 ASGI 中间件）
├── research/   H1-H22 假设回测（已全部裁决，休眠；预注册在 docs/research/prereg/）
├── indicators/ snapshot/ tools/                指标计算 / 快照组装 / Agent 工具
└── tools/（仓库层 backend/tools/）             运维脚本：check_db / check_sources / check_ingest
```

## 硬规矩

- **三个库不是一回事**：账户对话 `PG_CONNINFO`、交易 `PG_TRADING_CONNINFO`、
  知识 `PG_KNOWLEDGE_CONNINFO`。`runtime` 在模块级就把三个池都开了,所以
  `.env` 少配一个,受影响的可能是看起来毫不相干的页面。
- **入口必须经 `runtime`**：`test_db_target.py` 用 AST 检查 main / 两个 worker /
  collect.backfill 都 import 了 runtime——那是写生产库的守卫。知识引擎的 CLI
  有意绕过（提取要经隧道写生产知识库）,但它们碰不到账户数据。
- **改 metric 要走 `collect/metrics.py`** 这个 SSOT,同步清单见
  `docs/data/data-sync.md`,一致性由 `tests/test_metrics.py` 守。
- 改动后跑 `PYTHONPATH=. python -m pytest tests -q`（534 条）。
