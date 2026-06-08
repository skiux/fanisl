"""集中配置：API key、默认行情参数、指标阈值。

阈值是"把数字翻译成人话"的字典——改这里就能调整快照的语义判定，
不用动 indicators / snapshot 的代码。
"""

from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class IndicatorThresholds(BaseModel):
    """阈值化参数：raw 指标 → 语义标签。

    技术面用通用绝对阈值（RSI/量比）；衍生品（资金费率/多空比）用**历史分位**判定，
    比固定绝对值更稳健——不同币种、不同行情下分布差异很大，分位制能自适应。
    """

    # RSI（通用，跨币种稳定）
    rsi_overbought: float = 70.0
    rsi_oversold: float = 30.0

    # 量比（相对 20 周期均量）
    volume_high_ratio: float = 1.5
    volume_low_ratio: float = 0.6

    # ATR 分位回看窗口（根）
    atr_percentile_window: int = 100

    # 未平仓量 24h 变化阈值（百分比）
    oi_change_significant_pct: float = 5.0
    # 价量背离的 OI 死区：|OI 24h 变化| 小于此值视为"持仓基本持平"，不报方向背离
    oi_divergence_deadband_pct: float = 1.0

    # 资金费率：按其近期历史的分位判定高/低（>high_pct 偏热，<low_pct 偏空/极低）
    funding_high_pct: float = 0.85
    funding_low_pct: float = 0.15

    # 多空比：按其近期历史分位判定拥挤（>=crowded_pct 拥挤多头，<=1-crowded_pct 拥挤空头）
    lsr_crowded_pct: float = 0.80

    # 基差：季度合约年化基差 >= 此为升水(contango)，<= 负此为贴水(backwardation)；
    # 无季度合约时退回看永续溢价，>=perp 升水、<=-perp 贴水。
    basis_contango_annual_pct: float = 2.0
    basis_perp_premium_pct: float = 0.03

    # 期权看跌/看涨未平仓比：>=high 防御(看跌堆积)、<=low 进攻(看涨堆积)
    pcr_high: float = 1.20
    pcr_low: float = 0.70
    # IV skew(OTM put IV - OTM call IV)：>=此偏下行恐慌，<=负此偏追涨
    iv_skew_pct: float = 2.0


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Anthropic
    anthropic_api_key: str = ""
    # 留空走官方 api.anthropic.com；第三方中转填基址（不带 /v1），如 https://vip.aipro.love
    anthropic_base_url: str = ""
    model: str = "claude-opus-4-8"
    max_tokens: int = 8000  # 给 adaptive thinking + 结构化分析留足空间

    # /chat/stream 的服务端逐字输出（中转不支持真流式，用这个做打字机效果）
    stream_chunk: int = 4  # 每个 delta 的字符数
    stream_delay_ms: int = 10  # 每个 delta 之间的间隔；设 0 则瞬间吐完

    # 行情（默认 OKX：Binance 在部分地区被封锁）
    exchange: str = "okx"

    # OANDA（金属 XAU/XAG）。demo 账户填 token，practice=True 走模拟盘域名
    oanda_api_token: str = ""
    oanda_practice: bool = True

    # Polygon（美股/指数/ETF/原油）
    polygon_api_key: str = ""
    # Coinalyze（聚合多所爆仓/资金费/OI/多空比；免费 key，coinalyze.net 注册）
    coinalyze_api_key: str = ""
    # LunarCrush（单币社交热度/情绪/注意力；免费档单 Bearer key）
    lunarcrush_api_key: str = ""

    # 事件与催化剂（Part 2）。代币解锁(DefiLlama)无需 key；以下为免费 key，填了对应维度才启用。
    fred_api_key: str = ""  # 宏观日历（FRED）
    coinmarketcal_api_key: str = ""  # 币圈事件（CoinMarketCal）
    cryptocompare_api_key: str = ""  # 新闻（CoinDesk Data，原 CryptoCompare）
    # 新闻聚合（多源，填了哪个就启用哪个，结果合并去重）
    newsapi_api_key: str = ""  # NewsAPI.org
    finnhub_api_key: str = ""  # Finnhub
    benzinga_api_key: str = ""  # Benzinga
    default_symbol: str = "BTC/USDT"
    default_timeframes: list[str] = ["1h", "4h", "1d"]
    ohlcv_limit: int = 600  # 拉多少根 K 线（≥600 让 EMA200 充分收敛；超 300 自动分页）

    # 存储：PostgreSQL + TimescaleDB（libpq conninfo；默认走本地 socket + 当前用户）
    pg_conninfo: str = "dbname=fanisl"
    # 旧 SQLite 文件路径，仅供一次性数据迁移 migrate_sqlite 读取
    db_path: str = "fanisl.db"

    # 数据采集（后台调度，写时间序列）
    watchlist: list[str] = [
        "BTC/USDT",
        "ETH/USDT",
        "SOL/USDT",
        "BNB/USDT",
        "XRP/USDT",
    ]
    collector_enabled: bool = True
    collect_market_interval_s: int = 900  # 价格/衍生品/情绪/链上：15 分钟
    collect_catalysts_interval_s: int = 86400  # 解锁/宏观/新闻：每天

    # 保留 / 压缩：交给 TimescaleDB 原生策略（hypertable + 压缩 + retention）
    retention_days: int = 365  # 超过此天数的原始样本自动 drop_chunks
    compress_after_days: int = 7  # 超过此天数的 chunk 自动列式压缩（~10x，节省空间）
    runs_keep: int = 500  # 采集日志最多保留行数（log_run 内顺带裁剪）

    thresholds: IndicatorThresholds = Field(default_factory=IndicatorThresholds)


@lru_cache
def get_settings() -> Settings:
    return Settings()
