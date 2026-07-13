# fanisl 后端设计（v1：对话式盘面分析助手）

> **[历史设计]** 立项时的后端设计。现状以 [project-structure.md](../project-structure.md) 为准。

> 定位：Claude 是大脑，后端是它的手脚和记忆。后端**不做分析判断**，只负责
> ①按 Claude 要求取真实行情数据、算指标、打包成语义快照；②存对话历史。
> Claude 只做"给人看的盘面解读/决策支持"，**不下买卖结论、绝不编数字**。

## 1. 范围（v1）

- 形态：纯对话（非流式，v1 不上 SSE）。
- 数据深度：**技术面 + 衍生品情绪**。
  - 技术面（多周期 1h/4h/1d）：OHLCV + 均线(EMA20/50/200)、RSI、MACD、布林带、ATR、量比。
  - 衍生品：资金费率(funding rate)、未平仓量(open interest, 含变化)、多空比(long/short ratio)。
- 数据源：CCXT 永续合约，**默认 OKX**（Binance 的 fapi 在部分地区返回 451 地区封锁）；
  数据源可插拔（`EXCHANGE` 可配），留扩股票/其他所的口子。用户传 `BTC/USDT`，内部解析成
  该所线性永续符号（OKX 上为 `BTC/USDT:USDT`）。
- 存储：SQLite（两张表）。
- 模型：默认 `claude-opus-4-8`，可切 `claude-sonnet-4-6`。
- 数据到 Claude 的方式：**方案 A — 工具循环（tool use）**。Claude 自己决定何时调
  `get_market_snapshot`，后端实时取数返回，Claude 继续推理。

## 2. 数据流

```
用户消息 → FastAPI /chat → agent.run_turn(history)
  → Claude(SDK) --tool_use--> dispatch_tool(get_market_snapshot)
       → data(CCXT) → indicators(pandas/numpy) → snapshot(语义化)
  → tool_result(快照JSON) 塞回 → Claude 继续
  → Claude 不再要工具 → 自然语言分析 → 存库 → 返回前端
```

取数是**实时、按需**的：Claude 调工具那一刻才拉最新数据。

## 3. 盘面快照（核心数据契约）

raw 数字 → 阈值化语义标签，**同时保留真实数字**（让 Claude 能引用真实值、可审计防编造）。
结构见 `models.py` 的 `MarketSnapshot`：

- `meta`: symbol / exchange / fetched_at / data_warnings
- `timeframes[tf]`: last_price, change_pct, trend(均线排列/对EMA200位置), momentum(RSI+状态/MACD状态),
  volatility(ATR+30日分位/布林位置/带宽状态), volume(量比+状态), key_levels(swing高低/布林上下轨)
- `derivatives`: funding_rate(值+状态), open_interest(值+24h变化+状态), oi_price_divergence(价量背离四象限),
  long_short_ratio(值+状态)

阈值全部在 `config.py` 可配置（RSI 超买/超卖线、funding 过热线、价量背离判定等）。

## 4. 目录结构 & 模块职责

```
backend/
├── pyproject.toml            # uv 管理依赖
├── .env.example              # ANTHROPIC_API_KEY, EXCHANGE 等
└── src/analyzer/
    ├── main.py               # FastAPI app；POST /chat（非流式）
    ├── agent.py              # Claude 多轮 + 工具循环（含 prompt caching）
    ├── config.py             # pydantic-settings：key/默认值/指标阈值
    ├── prompts.py            # 系统提示词：角色与边界
    ├── models.py             # pydantic：快照 + 工具 I/O 契约
    ├── storage.py            # SQLite：对话/消息读写
    ├── tools/
    │   ├── registry.py       # 工具 JSON schema + dispatch 分发
    │   └── market.py         # get_market_snapshot 编排
    ├── data/
    │   ├── base.py           # MarketDataSource 抽象接口
    │   └── ccxt_source.py    # Binance 实现
    ├── indicators/compute.py # 纯函数：DataFrame → 指标（pandas/numpy 自实现）
    └── snapshot/builder.py   # 指标 + 阈值 → 语义化 MarketSnapshot
```

职责隔离：`data` 只取原始数据；`indicators` 纯函数算指标（无 IO）；`snapshot/builder`
只做数字→语义翻译（无 IO）；`tools/market` 编排三层；`agent` 只管和 Claude 对话+跑循环。

## 5. 工具循环 & Claude 集成

- **prompt caching**：system prompt + tools 每轮不变，打 `cache_control: ephemeral`，多轮命中缓存降本降延迟。
- **循环终止**：`stop_reason == "tool_use"` 则执行工具、塞回 tool_result 继续；否则为最终回复返回。
  每轮 assistant content（含 tool_use）与 user tool_result 完整入库。
- **工具错误不抛异常**：取数失败返回 `{is_error, error}` 的 tool_result，Claude 转告用户而非编造。
- **系统提示词钉死角色**：只引用快照真实数字、缺数据明说、给推理过程、输出
  「趋势判断/关键支撑阻力/当前位置风险/几种情景假设」、不下买卖结论。

## 6. 数据库（SQLite）

```sql
conversations(id PK, title, created_at, updated_at)
messages(id PK, conversation_id FK, role, content_json, created_at)
```

`content_json` 存原始 content blocks（含 tool_use/tool_result），原样喂回 Claude。
（可选/TODO）`snapshots` 表落盘每次快照，便于审计。

## 7. 数据源抽象（留股票口子）

`MarketDataSource` 接口：`fetch_ohlcv / fetch_funding_rate / fetch_open_interest / fetch_long_short_ratio`。
CCXT(Binance USD-M) 为首个实现。衍生品数据 best-effort，缺失返回 None 并写入 `data_warnings`；
OHLCV 为必需。扩股票 = 新增实现同接口，上层不改。

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| 交易所限流 | CCXT enableRateLimit + 指数退避重试 |
| 币种不存在/输入非法 | 取数前校验，工具返回结构化 error |
| 某周期/衍生品缺失 | 字段置 None + data_warnings 标注，不中断其余 |
| Claude 想编数字 | 系统提示词约束 + 真实数字可审计 |
| Anthropic API 报错 | /chat 返回 5xx + 错误信息 |

## 9. 测试策略

- `indicators/compute`：已知序列断言指标值（纯函数）。
- `snapshot/builder`：阈值边界语义标签断言。
- `data`：录制 CCXT 响应 fixture，mock 不联网。
- `agent`：mock Anthropic client，断言工具分发/历史拼装/终止/错误传达。
- 冒烟（可选，打 flag）：真连 Binance 拉一次 BTC。

## 10. 默认值（已确认）

交易所 Binance；周期 1h/4h/1d；DB SQLite；模型 opus-4-8；指标=均线/RSI/MACD/布林/ATR/量比 + funding/OI/多空比。
实现微调：指标用 pandas/numpy 自实现（不引 pandas-ta），隔离在 compute.py。
