# 数据源现状与缺口（2026-06-07，已用真实 key 实测）

按资产类别接官方源，自己算指标。路由：`data/instruments.py` 的 Resolver 按 symbol 分发。

## 已验证可用 ✅

| 资产 | 标的 | 源 | 周期 | 备注 |
|---|---|---|---|---|
| 加密 | BTC/USDT 等任意 CCXT 对 | OKX | 1h/4h/1d | 含衍生品（资金费率/OI/多空比） |
| 美股 | NVDA / MU / CRCL | Polygon(免费) | **1d/1wk** | 仅 EOD；已测 NVDA/MU |
| ETF | QQQ | Polygon | 1d/1wk | 已测 |
| 指数 | NDX (`I:NDX`) | Polygon | 1d/1wk | 已测，免费档可取 |
| 金属 | XAU / XAG | OANDA(practice) | 1h/4h/1d | 已测，含日内 |

非加密只有技术面、无衍生品；价格也对账过（NVDA 205、NDX 28957、QQQ 705、XAU 4327、XAG 67.75）。

## 加密衍生品维度（2026-06-07 扩充）

把数据从"只有价格自身行为"提到"决策支持"：引入与价格正交的信息维度。免费聚合栈：

| 维度 | 源 | key | 状态 |
|---|---|---|---|
| 资金费率 / OI / OI-价格背离 / 多空比(全市场) | OKX (CCXT) | 无 | ✅ 已有 |
| **大户多空账户比**（聪明钱） | OKX rubik top-trader | 无 | ✅ 实测 BTC 1.25 |
| **基差 / 期限结构**（永续溢价 + 季度年化基差） | OKX (永续 mark vs 现货 + 交割合约) | 无 | ✅ 实测 BTC perp −0.05% / 季度 +3.2% contango |
| **期权情绪**（PCR / max pain / DVOL·ATM IV / IV skew / OI 行权价堆积） | Deribit 公开 API | **无需 key** | ✅ 实测 BTC DVOL 48 / SOL maxpain $85 / XRP maxpain $2 |
| **爆仓数据**（多/空 24h 被爆额、主导方、尖峰） | Coinalyze 聚合多所 | 免费 key | ✅ 实测 BTC 多$35M/空$54M（26所聚合），字段已核验 |

期权覆盖：BTC/ETH 走币本位(currency=BASE，**含 DVOL**)；SOL/XRP/AVAX/TRX/BNB/MATIC 走
USDC 本位线性(currency=USDC 按前缀过滤，**无 DVOL**)。其余币种无期权市场→该块为空且**不告警**
（没期权是正常的，非"数据不可用"）。`OptionsProvider.covers(base)` 决定是否取/告警。
注：早先误以为 SOL/XRP 走 currency=SOL（实际 0 条），2026-06-07 实测修正为 USDC 本位。

## 缺口（后面再解决）⚠️

1. **爆仓热力图（磁吸位/清算压力堆积预测模型）**：唯一**必须付费**的维度——
   Coinglass V4 独家（**无免费档**，入门 Hobbyist $29/月 30次/分）。自己复刻需连 30+ 所
   WS 聚合，工程量巨大。**决定订阅后**再接（作为一个数据源接进抽象层即可）。
2. **Coinalyze 爆仓**：免费 key（40次/分）✅ 已接已验。注：用户报告其本机终端偶发调不通
   （浏览器正常），属网络环境问题非代码——本环境实测可达。
3. **美股/指数日内（1h/4h）**：Polygon 免费档只有 EOD（已加陈旧守卫，只用 1d/1wk）。
   要日内：升级 Polygon 付费档 / yfinance（免费 60m）。
4. **原油 CL1!**：Polygon 不识别该 ticker，NYMEX 期货需 Polygon Futures 产品。
   备选：Polygon Futures / Databento / yfinance `CL=F`。
5. **限速**：Polygon 免费 5 次/分（已加 429 退避重试）。

## 数据层级升级：bulk 归档源实地排查（2026-07-09，H21 期间实测）

研究一再指向"免费日线数据信息太小"→ 排查更深层级（tick/订单流/盘口）的免费 bulk 源，
全部从本机网络**实测可达性**（教训：API 封锁 ≠ CDN 封锁）：

| 源 | 可达性 | 内容 | 价值 |
|---|---|---|---|
| **`data.binance.vision`**（GitHub: binance/binance-public-data） | ✅ **可达**（api/fapi 被 451，bulk S3/CDN 没封；S3 列目录也通） | USDT-M 永续 **872 符号**（含退市：LUNA/SRM/FTT）月度/日度 zip：`fundingRate`（逐次结算 2020-01+）、`klines`（1m~1d）、**`aggTrades`/`trades`（逐笔含 taker 方向 = CVD/订单流）**、`bookTicker`（最优报价）、`bookDepth`（盘口深度，日档）、**`metrics`（2020-09+，5min：OI 量/USD、大户 LSR 账户+持仓两口径、全市场 LSR、taker 买卖比）**、mark/index/premium klines（基差历史） | **一次性关掉三个老缺口**：OI/LSR/taker 深历史（原只有 Coinalyze ~30-150d）、订单流(CVD)、含退市名的 PIT universe。H21 已用 fundingRate+klines 1d（`research/backfill_um_bulk.py`，147 符号） |
| `public.bybit.com` | ✅ 200 | 全符号逐笔成交归档（tick CSV） | 冗余源/交叉验证 |
| Dukascopy datafeed（GitHub: Leo4815162342/dukascopy-node） | ❌ 本沙箱超时 | FX/CFD tick（含 XAU、Brent/WTI CFD，2010+） | **油/金的免费 tick 源**——用户终端可再试（网络差异，参考 Coinalyze 先例）；通了就是 TradFi 盘中研究的钥匙 |
| OANDA candles（已接） | ✅ | H1 实测 2008+（WTI 111k 根已入库 `price_1h`）；**M1 未探深度**，理论同样 from 分页可拉 | TradFi 分钟级事件研究的现成路径，无需新 key |
| Tardis.dev / Coinglass | 付费 | tick 级衍生品全家桶 / 爆仓热力图 | 仍是付费缺口，不动 |

**含义**：加密侧"数据层级"缺口基本消失——盘中/订单流/盘口/持仓深历史都有免费 bulk。
TradFi 侧盘中靠 OANDA（H1 已验证、M1 待探），tick 靠 Dukascopy（待用户终端验证可达性）。
注意 bulk 下载要带 sleep + 重试 + 404 跳过（上市前/退市后月份 404 是正常语义，非错误）。

## 事件与催化剂（Part 2，进行中）

独立工具 `get_catalysts(symbol?)`（与 `get_market_snapshot` 分开），可插拔 catalyst provider
（`data/catalysts.py`）。各维度 best-effort，缺源记 warning（区分「未接入」vs「暂无数据」）。

| 维度 | 源 | key | 状态 |
|---|---|---|---|
| **代币解锁/归属** | DefiLlama 数据集 CDN | **无需 key** | ✅ 实测 OP/SOL/ARB（下次解锁+30/90天占供给%），BTC 等非归属优雅返回无解锁 |
| **宏观日历** | FRED | 免费 key | ✅ 实测 CPI/PPI/零售/GDP/PCE/就业 前瞻日期；只给日期无预期值 |
| **新闻标题** | CoinDesk Data(原 CryptoCompare) | 免费 key | ✅ 实测 50 条，可按币 categories 过滤 |
| 币圈事件 | CoinMarketCal | — | ❌ **API 已转付费**($49.8/月起)；用户无法注册。免费替代 Coindar 需另注册。当前由**新闻+解锁**部分覆盖 |
| **ETF 资金流** | — | — | ❌ 无干净免费源（Farside 被 Cloudflare 403）→ 待订阅，见 `data-upgrades.md` |

**Part 2 缺口 ⚠️**：
- **FOMC/利率决议日期**：FRED 前瞻模式下 FOMC 被填成每日噪声，已排除 → 缺口（要 Trading Economics 等付费日历，或硬编 Fed 公布的年度日程）。CPI/就业/GDP/PCE/PPI/零售（主要市场驱动项）已覆盖。
- **币圈事件**（上所/主网/升级/黑客的前瞻日程）：无干净免费 API（CoinMarketCal 付费 / Coindar 需注册）。

完整付费升级路线见 `doc/data-upgrades.md`。

## 情绪与注意力（Part 3，进行中）

进 `get_market_snapshot` 的 `sentiment` 块（仅加密；**当确认信号用，社交易被机器人灌水**）。

| 维度 | 源 | key | 状态 |
|---|---|---|---|
| **恐惧贪婪指数**（全市场温度计，极值反指） | Alternative.me | **无需 key** | ✅ 实测=12 Extreme Fear |
| **社交热度/情绪**（galaxy_score/social_dominance/sentiment/互动量/alt_rank） | LunarCrush v4 | — | ❌ **API 已转付费**：免费 key 全端点返回 402（需 Individual+ 订阅）。代码就绪、暂不挂 |
| 社交+链上复合情绪 | Santiment | 免费 key | ⚠️ 免费档**社交指标有 30 天滞后**（实时拿不到）→ 不适合"注意力突增"用途；要实时需 Max 付费档 |

LunarCrush 同 CryptoPanic 一样，免费 API 档已取消（2026）。**社交维度现状=完全缺失**：
LunarCrush 需订阅、Santiment 免费档滞后 30 天、CoinGecko community 数据稀疏。备选见 data-upgrades。

## 链上数据（Part 4，进行中）

进 `get_market_snapshot` 的 `onchain` 块（仅加密）。免费只够拿子集，高价值流向/估值多付费。

| 维度 | 源 | key | 状态 |
|---|---|---|---|
| **稳定币供应**（全市场干火药 + 7d/30d 变化） | DefiLlama stablecoins | **无需 key** | ✅ 实测 $314.5B |
| **公链 DeFi TVL**（按 tokenSymbol 匹配链 + 30d 变化） | DefiLlama | **无需 key** | ✅ 实测 BTC/SOL/ARB(Arbitrum) 均命中 |
| **网络使用度**（活跃地址/交易数/手续费，目前 BTC） | Blockchain.info | **无需 key** | ✅ 实测 BTC 活跃地址 538k(+9.7%/7d) |

**Part 4 缺口（高价值但付费/拿不全）⚠️**：
- **交易所流入/流出**、**Exchange Whale Ratio** → CryptoQuant / Glassnode（付费）。
- **MVRV / SOPR / 已实现价格 / 成本基准分布(URPD) / 长短期持有者供应** → Glassnode（免费仅日级+延迟，小时级付费）。
- **巨鲸/聪明钱钱包标签** → Nansen（付费，最强）；Binance 仅部分、**拿不全**——记为缺口。
- **ETH/山寨网络使用度**（活跃地址/手续费）→ 目前仅 BTC（Blockchain.info）；ETH 需 Etherscan/其他。

## 环境变量

已配好并验证 ✅：
```
POLYGON_API_KEY=...     # 美股/指数/ETF（免费档=EOD）
OANDA_API_TOKEN=...     # 金属 XAU/XAG
OANDA_PRACTICE=true
COINALYZE_API_KEY=...   # 加密爆仓（已验；终端偶发网络问题，best-effort 降级为 warning）
FRED_API_KEY=...        # 宏观日历（已验，已启用）
CRYPTOCOMPARE_API_KEY=... # 新闻（已验，已启用）
```
无需 key 自动启用：Deribit 期权、DefiLlama 代币解锁/稳定币/链TVL、Alternative.me 恐惧贪婪、Blockchain.info BTC 网络。

已配但**用不了**（API 转付费，未挂）：
```
LUNARCRUSH_API_KEY=...    # 社交热度（免费 key 全端点 402，需 Individual+ 订阅）
COINMARKETCAL_API_KEY=... # 币圈事件（用户注册不了；且 API 本身已付费）
```
