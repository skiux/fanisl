# fanisl 数据现状全清单（详细版）

更新于 2026-06-10。本文逐维度列出：**存的字段（DB metric 名）→ 当前源 → 现在前向存什么
→ 历史可回填到多深 → 局限 → 后期订阅**。配套升级路线见 [data-upgrades.md](data-upgrades.md)；
交易台自身的数据见 [trader-data.md](trader-data.md)。

## 全局说明

- **两类时间序列写入**：
  - **前向采集**（collector，每 15min）：只对**加密 watchlist**（BTC/ETH/SOL/BNB/ZEC）+ 全市场
    GLOBAL 落库；`write_changed` 去重（值不变不重复写）。TradFi（股/商品/金属）**不进前向采集**，
    只在交易决策时按需取，**目前没有时间序列**。
  - **历史回填**（`python -m analyzer.backfill`，一次性）：把过去的数据按各自时间戳灌进库。
- **存储表**：行情/衍生品/情绪/链上的时序都在 `fanisl` 库的 `metric_samples`（scope/symbol/metric/ts/value
  的长表，TimescaleDB hypertable）；事件/催化剂在 `catalyst_items`（快照型，非时序）。
- **回填深度图例**：✅已回填 ｜ 🟡端点本就给全历史·待回填(深，多年) ｜ 🟠源只留~30天·待回填(浅)
  ｜ ⚪可由 OHLCV/已有数据重构·待做 ｜ ❌无历史源（只能靠前向一点点攒）。

## ⚠️ `ts` 字段的语义（按数据类型不同！）

`ts` = 该数值**关联的时间**，但具体含义**因 metric 而异**，读数时务必分清：

| 数据类 | `ts` 是什么 | 例 |
|---|---|---|
| 指标/价格(回填) | 该 K 线的**周期时间**(开盘时刻) | rsi_1d 的 2026-06-09 = 6/9 那根日线 |
| 前向采集 | **采样那一刻**(每 15min) | price 的 2026-06-10 22:00 = 那次采集 |
| funding | **结算时刻**(每 8h) | — |
| 恐惧贪婪/稳定币/TVL/网络 | 该数值**所属的那一天** | — |
| **宏观(FRED)** | **数据的参考期**，**不是发布时刻** | 非农 `2026-05-01` = **5 月**的数据 |

**重点（回答"非农怎么是 5/1 不是 6/5 8:30"）**：FRED 给的是"这个数描述哪段时间"——5 月非农的 `ts`
就是 `2026-05-01`，但它实际是 **6 月初才公布**的。所以宏观 `ts` ≠ 公布时刻。

> **前视偏差(lookahead)注意**：用宏观历史做"某天的盘面"回溯时，参考期 ts 会让你"提前知道"还没发布的
> 数据（如 5/15 就看到 5 月 CPI，而它 6 月才出）。要严格 point-in-time，应改用**发布日期**做 ts
> （FRED releases/ALFRED 有发布时间）——这是已知待办，当前回填用的是参考期。

---

## A. 行情 / 技术面（每个加密标的，逐周期）

源：**Binance**（CCXT，无 key）。指标在 `compute_indicators` 算好，`flatten` 落库，带 `_{tf}` 后缀。

| 字段(metric) | 含义 | 现在前向存 | 历史回填 |
|---|---|---|---|
| `price` | 最新价（取最细周期收盘） | 每 15min | ✅ 深（1d 到 2017、1w 到上市；`--limit` 控深度） |
| `change_pct_{tf}` | 周期涨跌% | ✅ | ✅ |
| `rsi_{tf}` | RSI(14) | ✅ | ✅ |
| `macd_hist_{tf}` | MACD 柱 | ✅ | ✅ |
| `atr_{tf}` / `atr_pct_{tf}` | ATR 及其近 100 根分位 | ✅ | ✅ |
| `vol_ratio_{tf}` | 量 / 20 周期均量 | ✅ | ✅ |
| `bb_upper_{tf}` / `bb_lower_{tf}` | 布林上下轨 | ✅ | ✅ |

周期：前向用 1w/1d/4h/1h/15m/5m；回填默认 1w/1d/4h/1h（日内深度靠 `--limit` 加大）。
**局限**：单所(Binance)；EMA200 需 ~200 根才收敛，回填早段指标含 NaN 已跳过。

---

## B. 衍生品 / 持仓（仅加密永续）

源：**Binance** `fapiData*`（无 key）+ Deribit（期权）+ Coinalyze（爆仓）。

| 字段(metric) | 含义 | 当前源 | 历史回填 | 局限 |
|---|---|---|---|---|
| `funding_rate` | 资金费率 | Binance | ✅ 已回填(~月级，可分页更深) | 单所 |
| `funding_annualized` / `funding_percentile` | 年化 / 历史分位 | Binance | ⚪ 可由 funding 历史重算(待做) | — |
| `open_interest_usd` | 未平仓名义(USD) | Binance fapiData OI hist | ✅ 已回填(~20 天，源只留这么多) | 单所；浅 |
| `lsr` | 全市场多空账户比 | Binance | ✅ 已回填(~20 天) | 散户口径 |
| `top_trader_lsr` | 大户**持仓比**(资金加权) | Binance | ✅ 已回填(~20 天) | 单所 |
| `taker_buy_sell_ratio` | 主动买卖量比 | Binance | ✅ 已回填(~20 天) | 单所 |
| `funding_percentile`/`lsr_percentile`/`taker_percentile` 等分位 | 各自历史分位 | 取数时算 | ⚪ 未回填(可由上面历史重算) | — |
| `basis_perp` | 永续相对现货溢价% | 由 perp/spot ticker 算 | ⚪ 未回填(可由 perp+spot OHLCV 重构，深) | — |
| `basis_quarterly` | 季度合约年化基差% | Binance 交割合约 | 🟠 季度合约历史有限 | 浅 |
| `dvol` | Deribit 波动率指数(年化IV) | Deribit | ⚪ Deribit DVOL 历史端点(深，仅 BTC/ETH，待做) | 仅 BTC/ETH |
| `atm_iv` / `put_call_ratio` / `iv_skew` / `max_pain` / `options_total_oi` | 期权情绪快照 | Deribit | ❌ 无干净免费历史(只能前向攒) | 仅 BTC/ETH |
| `liq_long_24h` / `liq_short_24h` / `liq_total_24h` | 24h 多/空/总爆仓额 | Coinalyze | 🟠 Coinalyze 爆仓历史端点(部分，待做) | 限速低；无热力图 |

**后期订阅**：Coinglass V4（30+ 所聚合 funding/OI/LSR/爆仓 + **爆仓热力图** + ETF）是性价比最高的第一笔。

---

## C. 盘口微观结构（仅加密永续，瞬时）

源：**Binance** L2 盘口（`fetch_order_book`）。

| 字段(metric) | 含义 | 历史回填 |
|---|---|---|
| `spread_bps` | 买卖价差(基点) | ❌ 盘口无历史，只能前向攒 |
| `ob_imbalance` | mid±0.5% 买卖深度失衡 (-1..1) | ❌ |
| `ob_bid_depth_usd` / `ob_ask_depth_usd` | 买/卖侧名义深度(USD) | ❌ |

**局限**：瞬时快照，易被冰山/刷单干扰；主流币价差长期稳定 → `write_changed` 下落点稀疏（正常）。

---

## D. 情绪与注意力（全市场，scope=GLOBAL）

| 字段(metric) | 含义 | 当前源 | 历史回填 | 局限 |
|---|---|---|---|---|
| `fear_greed` | 恐惧贪婪指数 0~100 | Alternative.me（无 key） | ✅ 已回填（日级，回到 2018） | 粗、全市场单值、日级 |
| `galaxy_score` / `social_dominance` / `social_sentiment` | 单币社交热度/情绪 | ❌ **当前无源**（LunarCrush 转付费） | ❌ | **社交维度完全缺失** |

---

## E. 链上数据（加密）

| 字段(metric) | 含义 | scope | 当前源 | 历史回填 | 局限 |
|---|---|---|---|---|---|
| `stablecoin_total` | 全市场稳定币供应(USD) | GLOBAL | DefiLlama | ✅ 已回填(深，日级回到 2017) | — |
| `stablecoin_change_7d` / `_30d` | 7/30 天变化% | GLOBAL | DefiLlama | ⚪ 未回填(可由 total 历史重算) | — |
| `chain_tvl` | 公链 DeFi TVL(USD) | 每币 | DefiLlama | ✅ 已回填(深，日级 ~8 年) | 仅 L1 原生币 |
| `chain_tvl_change_30d` | 30 天变化% | 每币 | DefiLlama | ⚪ 未回填(可由 TVL 历史重算) | — |
| `active_addresses` / `tx_count` / `fees_usd` | 网络使用度 | 每币 | Blockchain.info | ✅ 已回填(深，日级 ~17 年) | **仅 BTC** |
| `unlock_tokens` | 已发生的解锁量(供给冲击) | 每币 | DefiLlama emissions | ✅ 已回填(事件级；仅归属型代币) | 回填专有，前向不产出 |

**后期订阅**：交易所流入流出/Whale Ratio → CryptoQuant；MVRV/SOPR/URPD → Glassnode；钱包标签 → Nansen。

---

## F. 事件与催化剂

催化剂本体（前瞻日程/最新头条）走 `catalyst_items`（快照型，先删后插，不做时序回填）。但其中两类有
**可量化的历史数值**，已抽成 `metric_samples` 时间序列回填：

| 维度 | 当前源 | 历史回填 | 局限 |
|---|---|---|---|
| **宏观数值**(通胀/就业/增长/利率/流动性) | FRED observations | ✅ 已回填(深，GLOBAL，回到 1947)。**通胀**(同比%)：`cpi_yoy`(headline，≈4.2%) `core_cpi_yoy` `core_pce_yoy`(美联储最看重) `ppi_yoy`；**就业**：`nonfarm_payrolls_chg`(非农月增) `unemployment_rate` `initial_jobless_claims`；**增长/消费**：`gdp_growth` `retail_sales_yoy`；**利率/货币**(FOMC 结果)：`fed_funds_rate` `fed_target_upper` `us_10y_yield` `us_2y_yield` `yield_curve_10y2y` `m2_money_supply` `fed_balance_sheet` `dxy_broad`；另存 `cpi_index`(指数水平，≠通胀) | 与"发布日历"是两回事——这是**实际值历史**；FOMC 利率结果有(`fed_funds_rate`/`fed_target_upper`)，缺的是会议**日期**的前瞻日历(FRED 噪声大，需专门源) |
| 代币解锁/归属 | DefiLlama 数据集 CDN | ✅ 已回填(已发生的解锁事件 → 每币 `unlock_tokens`，供给冲击历史) | 仅归属型代币；前瞻解锁仍在 catalyst_items |
| 宏观发布日历(前瞻日期) | FRED releases | ❌ 前瞻日程，非历史序列 | 只有日期、无预期/实际值；无 FOMC |
| 新闻标题(摘要/情绪/标的/分类) | CoinDesk Data + NewsAPI + Finnhub + Benzinga 聚合 | 🟠 免费档历史窗口很浅(NewsAPI~1月)，文本型，**未做时序回填** | 限速低 |
| 币圈事件(上所/主网/升级/黑客) | ❌ 无（CoinMarketCal 转付费） | ❌ 无源 | 无前瞻日程 |
| ETF 资金流(BTC/ETH) | ❌ 无干净免费源 | ❌ 无源 | 完全缺失 |

---

## 一句话现状（截至 2026-06-10，库跨度 1947→今、~28.5 万行、78 指标）

- **已深度回填(多年)** ✅：行情/全技术指标、funding、恐惧贪婪、稳定币供应、链 TVL、BTC 网络使用度、
  9 条 FRED 宏观数值、已发生的代币解锁。
- **已浅回填(~20 天，源头只留这么多)** ✅：OI、多空比、大户持仓比、taker。
- **可回填但未做（下一步）** ⚪：basis(perp+spot OHLCV 重构，深)、DVOL(Deribit，BTC/ETH 深)、
  爆仓(Coinalyze 历史，浅)、各分位字段(由已回填历史重算)。
- **无历史、只能前向攒** ❌：盘口微观结构、期权希腊值快照、社交（且当前无源）。
- **完全缺失维度**：社交情绪、ETF 资金流、爆仓热力图、链上深度（交易所流向/MVRV/SOPR）。

> 回填命令：`python -m analyzer.backfill`（幂等可重复）；深度由 `--limit` 控。
