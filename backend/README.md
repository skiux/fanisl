# fanisl backend

对话式加密货币盘面分析助手的后端。Claude 通过工具循环按需取真实行情、算指标、
打包成语义快照后做盘面解读；**只做给人看的辅助，不下买卖结论、不编数字**。

设计文档见 [`../doc/2026-06-05-backend-design.md`](../doc/2026-06-05-backend-design.md)。

## 运行

需要 Python 3.11+。

```bash
# 1. 装依赖（任选其一）
uv sync                      # 用 uv
# 或：python -m venv .venv && .venv/bin/pip install -e . pytest httpx

# 2. 配置 key
cp .env.example .env         # 填入 ANTHROPIC_API_KEY

# 3. 起服务
uv run uvicorn analyzer.main:app --reload --app-dir src
# 或：PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app --reload
```

打开 http://127.0.0.1:8000/docs 看接口。

## 接口

- `POST /chat` — `{"message": "BTC 现在怎么看？", "conversation_id": null}` →
  `{"conversation_id": 1, "reply": "..."}`。带上返回的 `conversation_id` 即可多轮对话。
- `GET /conversations` — 对话列表
- `GET /conversations/{id}/messages` — 某对话的完整消息（含工具调用）
- `GET /health` — 健康检查

## 测试

```bash
PYTHONPATH=src .venv/bin/python -m pytest    # 或：uv run pytest
```

测试不联网：data→indicators→snapshot→tool 流水线用合成数据，Claude client 被 mock。

## 结构

```
src/analyzer/
├── main.py          # FastAPI：/chat + 市场数据只读接口 + 采集器生命周期
├── agent.py         # Claude 工具循环（含 prompt caching）
├── config.py        # key / 默认值 / 指标阈值 / watchlist / 采集间隔
├── prompts.py       # 系统提示词：角色与边界
├── models.py        # pydantic 快照契约
├── storage.py       # SQLite 对话/消息
├── marketstore.py   # SQLite 时间序列(metric_samples)/催化剂/采集日志
├── flatten.py       # 模型 → 入库行（纯函数）
├── collector.py     # 采一轮 watchlist：复用工具函数 → flatten → 写库
├── scheduler.py     # 进程内后台线程调度（无新依赖、无 shell 脚本）
├── tools/           # get_market_snapshot / get_catalysts 编排 + 注册分发
├── data/            # 可插拔数据源 + 衍生品/情绪/链上/催化剂 provider
├── indicators/      # 纯函数算指标（pandas/numpy）
└── snapshot/        # 数字 → 语义标签
```

加新能力（信号 / 回测 / 新闻）= 在 `tools/registry.py` 注册一个新工具，agent 不用动。

## 数据采集与持久化（时间序列）

后台调度器定时把 watchlist 全维度数据采成时间序列，供前端可视化。设计见
[`../doc/2026-06-07-persistence-design.md`](../doc/2026-06-07-persistence-design.md)。
- 写：`scheduler` 定时 → `collector` 复用 `get_market_snapshot`/`get_catalysts` 取数 →
  `flatten` 摊平 → `marketstore` 入库（market 每 15min、catalysts 每天；`COLLECTOR_ENABLED=false` 可关）。
- 读（前端）：`GET /watchlist`（最新概览）、`GET /metrics?symbol=&names=&since=`（时间序列，
  `symbol=GLOBAL` 取全市场）、`GET /catalysts/stored`、`GET /collection/status`。
- 加新指标 = 在 `flatten.py` 加一行映射，采集/存储/接口都不用动。

## 数据源（可插拔）

按资产类别接不同源，自己算指标。三层：
- `data/base.py` — `MarketDataSource` 接口（`fetch_ohlcv` 必需；衍生品/`fetch_ticker` 可选）+ 共用 `ohlcv_df` / `_http.get_json` helper。
- `data/{ccxt,polygon,oanda}_source.py` — 各源实现（按 symbol 路由）。
- `data/instruments.py` — 标的登记表（symbol→源）+ `Resolver`（按 symbol 路由）。
- `data/factory.py` — 从 settings 组装所有源 → Resolver / CryptoSentiment。

**加密衍生品维度**（仅加密永续，正交于价格的信息）：
- 按 symbol 取（同一所，`MarketDataSource` 上的方法）：资金费率、未平仓量、OI-价格背离、
  多空比、**大户多空比**、**基差/期限结构**（永续溢价 + 季度年化基差）——均来自 OKX。
- 按币种 base 取（跨所，`data/derivatives.py` 的 provider，独立于 OHLCV 源）：
  - **期权情绪**（`DeribitSource`，**无需 key**）：PCR / max pain / DVOL·ATM IV / IV skew / OI 行权价堆积。
  - **爆仓数据**（`CoinalyzeSource`，免费 key，聚合多所）：填 `COINALYZE_API_KEY` 才启用。
  - 这两类由 `factory.build_crypto_sentiment` 组装成 `CryptoSentiment`，在快照工具里 best-effort 调用。
- 爆仓**热力图**（磁吸位预测）= Coinglass 付费独家，见 `../doc/data-gaps.md`，订阅后再接。

**情绪与注意力（Part 3）+ 链上（Part 4）**：也进 `get_market_snapshot`（仅加密）的 `sentiment` / `onchain` 块，
都挂在 `CryptoSentiment` bundle 上（`build_crypto_sentiment` 组装），best-effort：
- `sentiment`：恐惧贪婪指数（Alternative.me，无 key）✅；社交热度（LunarCrush，**API 已转付费**，暂缺）。
- `onchain`：稳定币供应 + 公链 TVL（DefiLlama，无 key）✅、BTC 网络使用度（Blockchain.info，无 key）✅。
- 高价值链上（交易所流向/MVRV/SOPR/巨鲸标签）多为付费，见 `../doc/data-upgrades.md`。

**事件与催化剂（Part 2，`get_catalysts` 工具）**：与价格正交、需推理的维度。独立于行情快照。
- `data/catalysts.py` — provider 抽象（解锁/宏观/事件/新闻/ETF 流）+ `Catalysts` 集合。
- `data/defillama_source.py` — 代币解锁（DefiLlama 数据集 CDN，**无需 key**）✅ 已接。
- 宏观(FRED)/事件(CoinMarketCal)/新闻(CoinDesk Data) 需免费 key，待接；ETF 流无免费源（待订阅）。
- `factory.build_catalysts` 组装 → `get_catalysts(symbol?)`。免费现状→付费升级见 `../doc/data-upgrades.md`。

**新增/更换数据源 3 步**（其余代码不用动）：
1. 写 `data/xxx_source.py`，继承 `MarketDataSource`，实现 `fetch_ohlcv`（合约源再实现衍生品三项）。
2. 在 `data/factory.py` 的 `sources` 字典里加一项 `"xxx": XxxSource(...)`。
3. 在 `data/instruments.py` 用 `_reg([...别名], Instrument(..., provider="xxx", ...))` 登记标的。

当前：加密=OKX(CCXT)、美股/指数/ETF/原油=Polygon、金属=OANDA。缺口见 `../doc/data-gaps.md`。
