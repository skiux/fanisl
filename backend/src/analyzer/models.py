"""数据契约：盘面快照 + 工具 I/O。

既是内部各层之间的契约，也是返回给 Claude 的 tool_result 的结构。
设计原则：每个语义字段旁边都带真实数字，Claude 才能引用真值、且可审计。
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# --- 单周期视图 ---------------------------------------------------------------


class TrendView(BaseModel):
    ema_alignment: str  # bullish | bearish | mixed
    price_vs_ema200: str  # above | below
    label: str  # 人话总结，如 "中期偏多、短期回调"


class MomentumView(BaseModel):
    rsi: float
    rsi_state: str  # overbought | oversold | neutral
    macd_hist: float
    macd_state: str  # bull | bear | golden_cross_forming | death_cross_forming


class VolatilityView(BaseModel):
    atr: float
    atr_percentile: float  # 0..1，相对近 N 日
    bb_position: str  # above_upper | upper_half | lower_half | below_lower
    bb_width_state: str  # expanding | contracting | stable


class VolumeView(BaseModel):
    vs_avg20: float  # 量比
    state: str  # above_average | below_average | normal


class KeyLevels(BaseModel):
    recent_swing_high: float
    recent_swing_low: float
    bb_upper: float
    bb_lower: float


class TimeframeView(BaseModel):
    last_price: float  # 实时价
    change_pct: float
    as_of: str | None = None  # 指标所用「最后一根已收盘 K 线」的时间（指标到此为止，非实时）
    trend: TrendView
    momentum: MomentumView
    volatility: VolatilityView
    volume: VolumeView
    key_levels: KeyLevels


# --- 衍生品情绪 ---------------------------------------------------------------


class FundingRate(BaseModel):
    value: float  # 单结算周期费率
    annualized_pct: float | None = None
    percentile: float | None = None  # 当前值在近期历史中的分位 0~1
    state: str  # high_long_pays | neutral | low_short_pays


class OpenInterest(BaseModel):
    value_usd: float | None = None
    change_24h_pct: float | None = None
    state: str  # rising | falling | flat | unknown


class LongShortRatio(BaseModel):
    """多空账户比。两个正交维度别混：
    - bias=绝对方向：value>1 账户净偏多(long)、<1 净偏空(short)。
    - vs_history=相对自身历史的高低：elevated/depressed/normal（看 percentile）。
    低分位(depressed)只代表"比平时更不偏多"，**不等于空头拥挤**。
    """

    value: float
    bias: str  # long | short | neutral（绝对：账户净方向）
    percentile: float | None = None  # 当前值在近期历史中的分位 0~1
    vs_history: str  # elevated | depressed | normal | unknown（相对自身历史）


class TakerVolume(BaseModel):
    """主动成交买卖量比(taker buy/sell)：吃单方向的即时主动性买/卖压力。

    >1=主动买量更大(买方更激进)、<1=主动卖压更大。短期动能/确认信号，别单独依赖。
    bias=绝对方向(buy/sell/neutral)；vs_history=相对自身近期分位(elevated/depressed/normal)。
    """

    value: float  # buyVol / sellVol
    bias: str  # buy | sell | neutral
    percentile: float | None = None  # 当前值在近期历史中的分位 0~1
    vs_history: str  # elevated | depressed | normal | unknown


class Basis(BaseModel):
    """基差 / 期限结构：永续相对现货的溢价、季度合约的年化基差。

    反映杠杆情绪与资金成本：升水(contango)=市场愿付溢价做多、情绪偏热；
    贴水(backwardation)=现货比期货贵、避险或空头情绪。
    """

    perp_vs_spot_pct: float  # 永续 mark 相对现货指数的溢价(%)，正=升水
    quarterly_annualized_pct: float | None = None  # 最近季度合约的年化基差(%)
    quarterly_expiry: str | None = None  # 该季度合约到期日
    state: str  # contango | backwardation | flat


class OptionsSummary(BaseModel):
    """期权情绪（Deribit，币圈期权主场）：市场对未来波动与方向的定价。"""

    underlying_price: float
    dvol: float | None = None  # Deribit 波动率指数（年化隐含波动率%），仅 BTC/ETH
    atm_iv: float | None = None  # 主力到期的平值隐含波动率(%)
    put_call_oi_ratio: float  # 看跌/看涨 未平仓比；>1 看跌堆积多
    pcr_state: str  # defensive | offensive | neutral
    iv_skew_pct: float | None = None  # OTM put IV - OTM call IV（正=下行恐慌定价更贵）
    iv_skew_state: str  # put_skew | call_skew | neutral
    max_pain: float | None = None  # 主力到期的最大痛点价位
    nearest_expiry: str  # 计算所用的主力到期（OI 最大的近月）
    total_oi_contracts: float  # 全市场期权未平仓（币本位）
    top_oi_strikes: list[dict] = Field(default_factory=list)  # 堆积最多的行权价


class Liquidations(BaseModel):
    """爆仓数据（Coinalyze 聚合多所，近 24h）。热力图(磁吸位)需付费源，见 data-gaps。"""

    long_usd_24h: float  # 多头被爆金额(USD)
    short_usd_24h: float  # 空头被爆金额(USD)
    total_usd_24h: float
    dominant_side: str  # long | short | balanced（哪边被爆更多）
    recent_spike: bool = False  # 最近一根是否出现明显爆仓尖峰


class OrderBook(BaseModel):
    """盘口微观结构（L2 深度快照）：填补"现货/合约流动性"维度。

    spread_bps=买卖价差(基点)，越大越不流动；depth=mid 上下 0.5% 内的挂单名义额(USD)；
    imbalance=(买深-卖深)/(买深+卖深)，正=买盘更厚(支撑)、负=卖盘更厚(压制)。
    瞬时快照，易被刷单/冰山影响，**当执行/流动性参考与短期确认用,别单独依赖**。
    """

    mid: float
    spread_bps: float
    bid_depth_usd: float  # mid 下 0.5% 内买单名义额
    ask_depth_usd: float  # mid 上 0.5% 内卖单名义额
    imbalance: float  # -1..1，正=买盘厚
    pressure: str  # bid_heavy | ask_heavy | balanced


class Derivatives(BaseModel):
    funding_rate: FundingRate | None = None
    open_interest: OpenInterest | None = None
    # 价量背离四象限：price_up_oi_up | price_up_oi_down | price_down_oi_up | price_down_oi_down
    oi_price_divergence: str | None = None
    long_short_ratio: LongShortRatio | None = None
    top_trader_lsr: LongShortRatio | None = None  # 大户持仓比/账户比（聪明钱方向）
    taker_volume: TakerVolume | None = None  # 主动买卖量比（即时买/卖压力，仅 Binance）
    basis: Basis | None = None
    options: OptionsSummary | None = None
    liquidations: Liquidations | None = None


# --- 情绪与注意力（Part 3）-----------------------------------------------------
# 反身性/叙事驱动维度：极值是反指，注意力突增常先于波动。**当确认信号用**，易被灌水。


class FearGreed(BaseModel):
    value: int  # 0~100
    label: str  # 原始分类，如 Extreme Fear
    state: str  # extreme_fear | fear | neutral | greed | extreme_greed（极值是反指）


class SocialMetrics(BaseModel):
    """单币社交热度/情绪（LunarCrush）。当确认信号用，别单独依赖。"""

    galaxy_score: float | None = None  # 综合健康分 0~100（社交+市场）
    alt_rank: int | None = None  # 社交+价格综合排名（越小越受关注）
    social_dominance: float | None = None  # 占全市场社交量比例(%)，注意力份额
    sentiment: float | None = None  # 加权情绪 0~100（>50 偏正面）
    interactions_24h: float | None = None  # 24h 社交互动量（注意力绝对量）


class Sentiment(BaseModel):
    fear_greed: FearGreed | None = None  # 市场整体温度计
    social: SocialMetrics | None = None  # 该币社交热度


# --- 链上数据（Part 4）--------------------------------------------------------
# 最正交、币圈独有：看链上真实经济行为，不受价格反身性污染。免费可得的是子集，
# 高价值的交易所流向/MVRV/SOPR/巨鲸标签多为付费（见 data-gaps）。


class StablecoinSupply(BaseModel):
    """全市场稳定币供应=场内"干火药"。扩张=潜在买力增加，收缩=流动性流出。"""

    total_usd: float
    change_7d_pct: float | None = None
    change_30d_pct: float | None = None


class ChainTVL(BaseModel):
    """该资产所在公链的 DeFi 锁仓总值（L1 原生币才有意义）。趋势反映链上资金。"""

    chain: str
    tvl_usd: float
    change_30d_pct: float | None = None


class NetworkActivity(BaseModel):
    """链上网络使用度（目前 BTC）：活跃地址/交易笔数/手续费——真实使用与需求。"""

    active_addresses: float | None = None
    active_addresses_change_7d_pct: float | None = None
    tx_count: float | None = None
    fees_usd: float | None = None


class OnChain(BaseModel):
    stablecoins: StablecoinSupply | None = None  # 全市场干火药
    chain_tvl: ChainTVL | None = None  # 该资产所在链
    network: NetworkActivity | None = None  # 该资产网络使用度


# --- 顶层快照 -----------------------------------------------------------------


class SnapshotMeta(BaseModel):
    symbol: str
    exchange: str
    asset_class: str = "crypto"  # crypto | stock | index | etf | metal | commodity
    fetched_at: str  # ISO8601 UTC
    data_warnings: list[str] = Field(default_factory=list)


class MarketSnapshot(BaseModel):
    meta: SnapshotMeta
    timeframes: dict[str, TimeframeView]
    microstructure: OrderBook | None = None  # 盘口深度/价差/失衡（执行与流动性参考）
    derivatives: Derivatives | None = None
    sentiment: Sentiment | None = None  # 情绪与注意力（仅加密）
    onchain: OnChain | None = None  # 链上数据（仅加密）


# --- 事件与催化剂（Part 2）----------------------------------------------------
# 与价格正交、值得被「推理」而非「计算」的维度：供给冲击、宏观、事件、新闻、机构流向。


class UnlockEvent(BaseModel):
    date: str  # YYYY-MM-DD (UTC)
    tokens: float  # 该次解锁代币数量
    pct_of_max_supply: float | None = None  # 占最大供给比例(%)，衡量供给冲击量级
    category: str | None = None  # 归属类别（团队/投资人/生态等）
    type: str  # cliff（悬崖一次性）| linear（线性）


class TokenUnlocks(BaseModel):
    """代币解锁/归属：供给侧催化剂。来自 DefiLlama（公开数据集）。"""

    symbol: str
    protocol: str
    next_event: UnlockEvent | None = None
    next_30d_pct_of_supply: float | None = None  # 未来30天累计解锁占最大供给(%)
    next_90d_pct_of_supply: float | None = None
    max_supply: float | None = None
    note: str | None = None  # 如「已基本全部解锁」「无归属计划」


class MacroEvent(BaseModel):
    date: str  # ISO8601
    name: str  # 如 CPI、FOMC Rate Decision
    importance: str | None = None  # high | medium | low
    actual: str | None = None
    forecast: str | None = None
    previous: str | None = None


class CryptoEvent(BaseModel):
    date: str
    title: str
    coins: list[str] = Field(default_factory=list)
    category: str | None = None  # listing | mainnet | upgrade | unlock | other


class NewsItem(BaseModel):
    published_at: str
    title: str
    source: str | None = None
    url: str | None = None
    summary: str | None = None  # 摘要/正文片段
    sentiment: str | None = None  # 情绪标签（部分源提供：positive/negative/neutral）
    tickers: list[str] = Field(default_factory=list)  # 相关标的
    categories: list[str] = Field(default_factory=list)  # 分类/频道/标签
    image_url: str | None = None
    provider: str | None = None  # 来源 API：cryptocompare/newsapi/finnhub/benzinga


class EtfFlow(BaseModel):
    asset: str  # BTC | ETH
    latest_date: str
    latest_flow_usd_m: float  # 最近一日净流入(百万美元)，负=净流出
    cumulative_usd_m: float | None = None
    trend_5d: str | None = None  # inflow | outflow | mixed


class CatalystReport(BaseModel):
    """get_catalysts 的返回契约。每块 best-effort：拿不到就为空 + 记 warning。"""

    symbol: str | None = None
    token_unlocks: TokenUnlocks | None = None
    macro_calendar: list[MacroEvent] = Field(default_factory=list)
    crypto_events: list[CryptoEvent] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)
    etf_flows: EtfFlow | None = None
    warnings: list[str] = Field(default_factory=list)


# --- 工具 I/O -----------------------------------------------------------------


class GetMarketSnapshotInput(BaseModel):
    symbol: str
    timeframes: list[str] | None = None


class GetCatalystsInput(BaseModel):
    symbol: str | None = None  # 省略=只看全市场催化剂（宏观/ETF/大盘新闻）


class GetMetricHistoryInput(BaseModel):
    symbol: str  # 币种(如 BTC/USDT) 或 GLOBAL（全市场指标：fear_greed/stablecoin_total）
    metrics: list[str]
    window: str | None = None  # 24h | 7d | 30d | 90d | all（默认 30d）


class ToolError(BaseModel):
    """工具失败时返回给 Claude 的结构化错误（不抛异常）。"""

    is_error: bool = True
    error: str
