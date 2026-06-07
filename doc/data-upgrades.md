# 数据源升级路线图（免费现状 → 后期付费替换）

记录每个维度**当前用的免费/临时源**，以及**后期为提质要订阅的付费服务**。
项目核心是数据——这份表用来在预算就绪时按价值排序逐个升级。抽象层已就位，
换源 = 实现对应 Source/Provider + 在 `data/factory.py` 挂上，其余代码不动。

更新于 2026-06-07。

## Part 1 · 持仓与衍生品

| 维度 | 当前（免费/临时） | 局限 | 后期订阅（提质） |
|---|---|---|---|
| 资金费率 / OI / 多空比 / 大户多空比 / 基差 | **OKX 单所**（CCXT，无 key） | 只反映 OKX 一家，非全市场聚合 | **Coinglass** V4（30+ 所聚合）/ Coinalyze 付费档 |
| 期权情绪（PCR/max pain/DVOL/IV skew/行权价 OI） | **Deribit** 公开 API（无 key） | 仅 Deribit（虽是主场）；无多源聚合 | Amberdata / Coinglass options / Laevitas（多源 + 历史曲面） |
| 爆仓数据（多/空 24h、主导方、尖峰） | **Coinalyze**（免费 key，40/min） | 限速低；无热力图 | **Coinglass** V4（更高频 + 热力图） |
| **爆仓热力图（磁吸位/清算压力堆积模型）** | ❌ **无免费源** | 完全缺失 | **Coinglass** Hobbyist **$29/月**起（独家模型；首选升级项） |

## Part 2 · 事件与催化剂

| 维度 | 当前（免费/临时） | 局限 | 后期订阅（提质） |
|---|---|---|---|
| 代币解锁/归属 | **DefiLlama** 数据集 CDN（无 key）✅已接 | 无 SLA；字段随前端变动风险 | DefiLlama **Pro API** / Tokenomist / CryptoRank（更全 + 稳定 + USD 量化） |
| 宏观日历（CPI/PPI/就业/GDP/PCE/零售） | **FRED**（免费 key）✅已接 | 只有日期、无预期值/重要度/实际值；**FOMC 排除**（FRED 前瞻噪声） | **Trading Economics** / FMP / FinanceFlowAPI（含 consensus/importance/actual + FOMC） |
| 币圈事件（上所/主网/升级/黑客/监管） | ❌ 无（CoinMarketCal API 转付费；当前由新闻+解锁部分覆盖） | 无前瞻事件日程 | **CoinMarketCal** 付费 / **Coindar**（免费需注册）/ Kaiko Events |
| 新闻标题 | **CoinDesk Data**(原 CryptoCompare，免费 key)✅已接 | 限速低；无情绪/投票 | CoinDesk Data 付费 / CryptoPanic 付费（含情绪/投票） |
| **ETF 资金流（BTC/ETH）** | ❌ **无干净免费源**（Farside 被 Cloudflare 拦 403） | 完全缺失 | **Coinglass** ETF（$29/月）/ SoSoValue API / Farside 手工 |

## Part 3 · 情绪与注意力

| 维度 | 当前（免费/临时） | 局限 | 后期订阅（提质） |
|---|---|---|---|
| 恐惧贪婪指数 | **Alternative.me**（无 key）✅已接 | 粗、全市场单值、仅日级 | 基本够用；要更细可自建（波动率+社交+趋势加权） |
| 单币社交热度/情绪 | ❌ **无**（LunarCrush 2026 起 API 转付费，免费 key 402） | 社交维度当前完全缺失 | **LunarCrush** Individual+ 订阅 / **Santiment** Max 付费（免费档社交滞后30天，不可用） |
| 社交+链上复合情绪 | — | 暂未接 | **Santiment** Max（免费/Pro 档对受限指标有 30 天滞后） |

## Part 4 · 链上数据（部分已接，最正交但最难免费）

| 维度 | 当前（免费/临时） | 后期订阅（提质） |
|---|---|---|
| 稳定币供应（干火药） | **DefiLlama**（无 key）✅已接 | 基本够用 |
| 公链 DeFi TVL | **DefiLlama**（无 key）✅已接 | 基本够用 |
| 网络使用度（活跃地址/交易/手续费） | **Blockchain.info**（无 key，**仅 BTC**）✅已接 | Glassnode（多链 + 更多指标）；ETH 用 Etherscan |
| 交易所流入/流出、Exchange Whale Ratio | ❌ 无 | **CryptoQuant**（专长交易所流向，偏 BTC/ETH） |
| MVRV/SOPR/已实现价格/成本分布(URPD)/持有者供应 | ❌ Glassnode 免费仅日级+延迟 | **Glassnode** 付费（小时/10分钟级 + 800+ 指标） |
| 巨鲸/聪明钱钱包标签 | ❌ 拿不全（Binance 仅部分） | **Nansen**（聪明钱标签，最强但贵） |

## key 现状

已配并启用 ✅：`FRED_API_KEY`（宏观）、`CRYPTOCOMPARE_API_KEY`（新闻）、`COINALYZE_API_KEY`（爆仓）、
`POLYGON_API_KEY`、`OANDA_API_TOKEN`。无需 key：Deribit/DefiLlama/Alternative.me/Blockchain.info。

已配但用不了（API 转付费）⚠️：`LUNARCRUSH_API_KEY`（社交，需订阅）、`COINMARKETCAL_API_KEY`（事件，需付费/用户注册不了）。

## 升级优先级建议（按"信息增量/成本"）

1. **Coinglass $29/月** — 一次性补齐两个完全缺失项（爆仓热力图 + ETF 资金流），还顺带把
   资金费/OI/多空比/爆仓升级成 30+ 所聚合。**性价比最高的第一笔订阅。**
2. **社交维度**当前完全缺失 → LunarCrush 订阅 或 Santiment 付费（去 30天滞后）。
3. **宏观**升级到 Trading Economics（补 FOMC + 预期值/重要度，FRED 只有日期）。
4. **链上**深度（交易所流向/MVRV/SOPR）→ CryptoQuant / Glassnode 付费。
5. 解锁升级 DefiLlama Pro / Tokenomist；事件 CoinMarketCal 付费 或 Coindar 注册；新闻付费档。
