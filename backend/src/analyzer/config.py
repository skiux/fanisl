"""集中配置：API key、默认行情参数、指标阈值。

阈值是"把数字翻译成人话"的字典——改这里就能调整快照的语义判定，
不用动 indicators / snapshot 的代码。
"""

from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AccountSpec(BaseModel):
    """评测账户规格。多账户做对照实验：A=自然(保留拒绝权)、B=强制交易、影子=机械镜像不被管理、
    setups=playbook 驱动（确定性触发 + Claude 闸门）。"""
    name: str
    force: bool = False          # 强制交易模式（不允许"不交易"）
    managed: bool = True         # Claude 是否参与持仓管理/复盘（影子账户=False，纯机械执行）
    mirror_of: str | None = None # 影子账户镜像哪个真实账户的进场计划
    setups: bool = False         # setup 探测账户：playbook 触发→闸门→开仓，出场由模板确定性执行
    manual: bool = False         # 手动账户：用户把自己的实盘交易镜像进来（Claude 完全不介入），
                                 # 用同一套按 setup 评 edge/基准对照的机械量化自己的酌情 edge


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

    @classmethod
    def settings_customise_sources(cls, settings_cls, init_settings, env_settings,
                                   dotenv_settings, file_secret_settings):
        # 让 .env 覆盖 shell 环境变量：本地 shell 里常有残留的 `export ANTHROPIC_BASE_URL=...`
        # /`ANTHROPIC_API_KEY=...`（给 Claude Code 等用的），默认会劫持本项目的 .env 配置，
        # 导致 app 把 .env 里的 key 发到了错误的 endpoint（典型现象：401→502）。
        # 把 dotenv 提到 env 之前，.env 即为本项目配置的唯一权威来源。init 仍最高（测试/显式覆盖有效）。
        return (init_settings, dotenv_settings, env_settings, file_secret_settings)

    # Anthropic
    anthropic_api_key: str = ""
    # 调用 Claude 的重试/超时（第三方代理偶发"无可用账号"/限流/慢，重试可自愈；单请求封顶避免长挂）
    anthropic_max_retries: int = 4
    anthropic_timeout_s: float = 180.0
    # 留空走官方 api.anthropic.com；第三方中转填基址（不带 /v1），如 https://vip.aipro.love
    anthropic_base_url: str = ""
    model: str = "claude-opus-4-8"
    max_tokens: int = 8000  # 给 adaptive thinking + 结构化分析留足空间

    # /chat/stream 的服务端逐字输出（中转不支持真流式，用这个做打字机效果）
    stream_chunk: int = 4  # 每个 delta 的字符数
    stream_delay_ms: int = 10  # 每个 delta 之间的间隔；设 0 则瞬间吐完

    # 行情（默认 Binance：数据维度最全；网络可达后从 OKX 切回。可用 EXCHANGE 切换）
    exchange: str = "binance"

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
    eia_api_key: str = ""   # EIA 开放数据（周度石油库存；免费注册 eia.gov/opendata）
    gemini_api_key: str = ""  # Google AI Studio（知识引擎 L0 triage/转录）
    youtube_cookies_file: str = ""  # 用户导出的 cookies.txt（YouTube bot 验证时用，相对 backend/）
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
    # 交易评测台：独立库（账户/计划/持仓/复盘/打分），与行情库分离
    pg_trading_conninfo: str = "dbname=fanisl_trading"
    pg_knowledge_conninfo: str = "dbname=fanisl_knowledge"  # 知识引擎（L0/L1/L2 独立库）
    # 旧 SQLite 文件路径，仅供一次性数据迁移 migrate_sqlite 读取
    db_path: str = "fanisl.db"

    # 数据采集（后台调度，写时间序列）
    # 高频采集(15min)只跑加密——Binance 实时、无频控；TradFi 分析走 Polygon/OANDA
    # (EOD/有频控)，在交易决策时按需取，不进高频采集，避免 429。
    watchlist: list[str] = [
        "BTC/USDT",
        "ETH/USDT",
        "SOL/USDT",
        "BNB/USDT",
        "ZEC/USDT",
    ]
    collector_enabled: bool = True
    collect_market_interval_s: int = 900  # 价格/衍生品/情绪/链上：15 分钟
    collect_catalysts_interval_s: int = 86400  # 解锁/宏观/新闻：每天
    knowledge_daily_interval_s: int = 86400  # 知识引擎日维护（行情→评分→节点状态）

    # 保留 / 压缩：交给 TimescaleDB 原生策略（hypertable + 压缩）
    # retention 默认关闭(0)：研究平台需要**永久**历史——365 天策略曾把 2006+ COT / 2010+ 股价等
    # 深回填整体吃掉（2026-07 事故，见 research-log）。>0 才注册 drop_chunks；0 = 不注册并移除已有策略。
    retention_days: int = 0
    compress_after_days: int = 7  # 超过此天数的 chunk 自动列式压缩（~10x，节省空间）
    runs_keep: int = 500  # 采集日志最多保留行数（log_run 内顺带裁剪）

    # 交易评测台（纸面永续 + 杠杆，实时前向）
    trading_enabled: bool = True
    trading_initial_balance: float = 1_000.0    # USDT（每个评测账户）
    trading_default_risk_pct: float = 1.0       # 单笔默认风险占权益%
    trading_max_leverage: float = 10.0
    trading_margin_mode: str = "cross"          # isolated | cross（全仓：共享保证金、策略空间更大）
    # 多账户对照实验：A=自然(保留拒绝权)、B=强制交易、影子=机械镜像 A 不被 Claude 管理、
    # setups=playbook 驱动（确定性触发 + Claude 闸门，不参与酌情管理/复盘——按 setup 聚合评测）
    trading_accounts: list[AccountSpec] = [
        AccountSpec(name="main"),
        AccountSpec(name="forced", force=True),
        AccountSpec(name="main_shadow", managed=False, mirror_of="main"),
        AccountSpec(name="setups", managed=False, setups=True),
        AccountSpec(name="live", managed=False, manual=True),
    ]
    trading_taker_fee_bps: float = 5.0          # 成交手续费（基点，1bp=0.01%）
    trading_slippage_bps: float = 2.0           # 市价成交滑点（基点）
    trading_min_rr: float = 2.0                 # 建议最小盈亏比（记录不硬卡）
    trading_tick_interval_s: int = 60           # 慢节奏：自主管理(重评)+ 自动复盘(调 Claude)
    trading_mark_interval_s: int = 15           # 快节奏：开仓时盯市/止损止盈检查（无持仓则跳过）
    # 决策用的完整多周期：大周期方向(1w/1d) → 交易结构(4h/1h) → 入场信号(15m/5m)
    trading_decision_timeframes: list[str] = ["1w", "1d", "4h", "1h", "15m", "5m"]
    # 持仓重评用精简周期（控成本：大周期定调 + 交易/入场周期看当下，不必每次全量 6 周期）
    trading_manage_timeframes: list[str] = ["1d", "1h", "15m"]
    # 持仓中：价格进入「距止损或某止盈 ≤ 此比例」的带 → 触发 Claude 重评
    trading_reeval_band_pct: float = 0.5
    trading_time_stop_hours: float = 0.0        # >0 则超过此持仓时长触发一次重评（0=关闭）
    trading_entry_ttl_hours: float = 8.0        # 限价进场单默认有效期（计划未指定 entry_ttl_hours 时用）
    # 复评治理：触发后冷却窗口 + 调整后宽限窗口（抑制电平触发造成的复评风暴）
    trading_reeval_cooldown_min: float = 30.0   # 同一条件触发重评后，此分钟内不再因同类条件重触发
    trading_reeval_grace_min: float = 15.0      # 任一 adjust 之后，此分钟内不触发新的重评（让动作生效）
    # 事件邻近风险调节：高影响宏观事件临近时自动给单笔风险打折（而非粗暴拒绝）
    trading_event_blackout_hours: float = 12.0  # 高影响事件前此小时内进场 → 风险打折
    trading_event_risk_haircut: float = 0.5     # 打折系数：邻近事件时 risk_pct 上限 = 原计划 × 此值
    # 拒绝力评测：到期后用价格变动校验"不交易"判断（朝 bias 方向走超过此 % = 错过 = 判错）
    trading_decline_move_threshold_pct: float = 0.5

    # 自主扫描（酌情模式，已降级）：研究结论=快照酌情判断无 edge（18 个 H 全 KILLED），
    # 默认关闭；代码保留作对照实验用，手动 /trading/open 入口不受影响。
    trading_scan_enabled: bool = False
    trading_scan_interval_s: int = 14400        # 每 4 小时扫一次（与 4h 结构周期对齐）
    # Setup 探测（重定位后的主进场路径）：确定性规则触发 → Claude 闸门 → 引擎执行
    trading_setups_enabled: bool = True
    trading_setup_interval_s: int = 3600        # 每小时探测一轮（长 horizon setup 足够）
    trading_max_positions: int = 3              # 最多同时持仓笔数
    trading_max_total_risk_pct: float = 5.0     # 所有持仓在险合计 ≤ 权益的此百分比
    trading_max_same_direction: int = 2         # 同方向持仓上限（相关性集中度约束，避免名义分散实为一注）
    trading_scan_timeframes: list[str] = ["1d", "4h"]  # triage 摘要用的精简周期

    thresholds: IndicatorThresholds = Field(default_factory=IndicatorThresholds)


@lru_cache
def get_settings() -> Settings:
    return Settings()
