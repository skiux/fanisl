"""标的登记表——资产**身份**的单一事实来源(SSOT)。

为什么有这文件：库里同一个资产有五套互不相认的拼法——claim 的 `asset_symbol`
(`XAUUSD`)、`data/instruments.py` 的 canonical(`XAU/USD`)、`daily_bars` 的 symbol、
`metric_samples` 的 symbol(`BTC/USDT`)、单元标签(`xauusd`)。没有任何一处能回答
"这是什么、我们有它的哪些数据"，于是"按标的看知识"这件事在后端根本无从查起。

**与 `data/instruments.py` 的分工**（两张表，别混）：
- 本表管**是什么**：名称、类别、别名、各命名空间里的符号；
- instruments.py 管**去哪取数**：provider 路由、分析源/执行源拆分、周期。
  它的登记逻辑一行不改，本表只通过 `instrument` 字段记下二者的对应关系。

**id 用 knowledge 的 `asset_symbol` 口径**（`XAUUSD` 而非 `XAU/USD`）：它是最大的
命名空间，且不含斜杠——`/assets/{id}` 与前端 `#/asset/{id}` 都要求 URL 安全。

**设计不变量：本表只增加身份信息，不改变任何既有符号的语义。**
- 不合并两个各自已存有数据的符号。`GOOG` 与 `GOOGL` 在 daily_bars 里是两条不同的
  序列（2026-08-27 收 337.71 / 340.65），这里就是两个标的，互相 `related` 而已；
  instruments.py 在**行情路由**层面把 GOOG 当 GOOGL 的别名，那是它的自由，所以
  GOOG 这一行不给 `instrument`。
- 别名只用于**入参解析**，且别名下不得已有数据。
- `yf` 是 daily_bars 的采集口径，`yf_symbol_map()` 导出给 `knowledge/prices.py`。
  **改这里就等于改每天的日线采集范围**，加/减符号是有意决定，测试里有等价性快照守着。

`display` 只在确知时填：指数/利率/汇率/金属/商品/ETF 的中文名不会有别的来源，
个股的正式名称将来由公司资料源（P2）回填，现在留空好过在 SSOT 里写猜的名字。
"""

from __future__ import annotations

from dataclasses import dataclass

# asset_class 词汇表（前端按此分组）：
#   index=指数 | etf=ETF | stock=个股 | metal=贵金属 | commodity=商品
#   crypto=加密 | rate=利率 | fx=汇率 | preipo=未上市
ASSET_CLASSES = ("index", "etf", "stock", "metal", "commodity", "crypto", "rate", "fx", "preipo")

CLASS_LABELS = {
    "index": "指数", "etf": "ETF", "stock": "个股", "metal": "贵金属",
    "commodity": "商品", "crypto": "加密", "rate": "利率", "fx": "汇率", "preipo": "未上市",
}


@dataclass(frozen=True)
class Asset:
    id: str                          # 规范 id（= claim 的 asset_symbol 口径，URL 安全）
    asset_class: str
    display: str | None = None       # 中文名；确知才填，个股待公司资料源回填
    aliases: tuple[str, ...] = ()    # 入参解析用的其它拼法（不得与任何 id 冲突）
    yf: str | None = None            # daily_bars 的 yfinance ticker（None=不采日线）
    yf_scale: float = 1.0
    yf_note: str = ""                # 口径备注（代理关系必须写清）
    fred: str | None = None          # FRED 序列 id（走公开 CSV，不走 yfinance）
    instrument: str | None = None    # data/instruments.py 的 canonical（None=不可路由）
    metric_symbol: str | None = None # metric_samples 里的 symbol（只有采集 watchlist 有）
    related: tuple[str, ...] = ()    # 同族/易混标的（不是合并，只是互相指路）
    note: str = ""

    @property
    def tag(self) -> str:
        """单元标签的写法。提取规范 §7 定死"资产标签 = 规范符号小写"。"""
        return self.id.lower()


def _s(id: str, display: str | None = None, **kw) -> Asset:
    """个股速写：yf ticker 与 id 同名是常态。"""
    return Asset(id, "stock", display, yf=id, **kw)


def _e(id: str, display: str | None = None, **kw) -> Asset:
    """ETF 速写。"""
    return Asset(id, "etf", display, yf=id, **kw)


_ASSETS: list[Asset] = [
    # --- 指数 -------------------------------------------------------------
    Asset("NDX", "index", "纳斯达克100指数", aliases=("^NDX", "NAS100", "IXIC"),
          yf="^NDX", instrument="NDX", related=("QQQ",)),
    Asset("SPX", "index", "标普500指数", aliases=("^GSPC", "SP500"),
          yf="^GSPC", related=("SPY", "RSP")),
    Asset("DJI", "index", "道琼斯工业指数", aliases=("^DJI",), yf="^DJI"),
    Asset("SOX", "index", "费城半导体指数", yf="^SOX", yf_note="费城半导体指数",
          related=("SOXX", "SMH", "SEMI")),
    Asset("KOSPI", "index", "韩国综合指数", yf="^KS11"),
    Asset("VIX", "index", "CBOE 波动率指数", yf="^VIX", yf_note="CBOE 波动率指数"),
    Asset("GSCI", "index", "标普高盛商品指数", yf="^SPGSCI",
          yf_note="标普高盛商品指数（能源权重约 40%）"),
    Asset("HSTECH", "index", "恒生科技指数",
          note="无可用日线源：^HSTECH 无数据、3033.HK 与 3067.HK 都不是点位口径，"
               "故点位型判断只能 priceable=false（判据见 knowledge/prices.py 注释）"),

    # --- 汇率 / 利率 ------------------------------------------------------
    Asset("DXY", "fx", "美元指数", yf="DX-Y.NYB", yf_note="ICE 美元指数"),
    Asset("AUDJPY", "fx", "澳元/日元", yf="AUDJPY=X"),
    Asset("US10Y", "rate", "美国10年期国债收益率", aliases=("^TNX",), yf="^TNX",
          yf_note="收益率%（yfinance 直读口径，实测 2026-05 为 4.48）"),
    Asset("US30Y", "rate", "美国30年期国债收益率", aliases=("^TYX",), yf="^TYX",
          yf_note="收益率%（直读口径）"),
    Asset("DFEDTARU", "rate", "联邦基金目标区间上限", fred="DFEDTARU",
          yf_note="联邦基金目标区间上限%"),
    Asset("T10Y2Y", "rate", "10年期减2年期国债利差", fred="T10Y2Y",
          yf_note="10年期减2年期国债利差%（牛陡/熊陡/倒挂的经典口径）"),

    # --- 贵金属 / 商品 ----------------------------------------------------
    Asset("XAUUSD", "metal", "黄金", aliases=("XAU", "XAU/USD", "GOLD"),
          yf="GC=F", yf_note="COMEX 金期货近月代理现货", instrument="XAU/USD"),
    Asset("XAGUSD", "metal", "白银", aliases=("XAG", "XAG/USD", "SILVER"),
          yf="SI=F", yf_note="COMEX 银期货近月代理现货", instrument="XAG/USD"),
    Asset("WTI", "commodity", "WTI 原油", aliases=("CL", "CL1!", "OIL", "USOIL", "CRUDE"),
          yf="CL=F", yf_note="NYMEX WTI 期货近月", instrument="CL", related=("BZ",)),
    Asset("BZ", "commodity", "布伦特原油", aliases=("BRENT",), instrument="BZ",
          note="Polygon 无 Brent，分析与执行都走 Binance 永续；无日线源"),

    # --- 加密（metric_symbol 是采集 watchlist，全维度指标只有这几个有）-----
    Asset("BTCUSDT", "crypto", "比特币", aliases=("BTC", "BTC/USDT", "BTCUSD"),
          yf="BTC-USD", yf_note="现货指数代理", metric_symbol="BTC/USDT"),
    Asset("ETHUSDT", "crypto", "以太坊", aliases=("ETH", "ETH/USDT"), metric_symbol="ETH/USDT"),
    Asset("SOLUSDT", "crypto", "Solana", aliases=("SOL", "SOL/USDT"), metric_symbol="SOL/USDT"),
    Asset("BNBUSDT", "crypto", "BNB", aliases=("BNB", "BNB/USDT"), metric_symbol="BNB/USDT"),
    Asset("ZECUSDT", "crypto", "Zcash", aliases=("ZEC", "ZEC/USDT"), metric_symbol="ZEC/USDT"),

    # --- ETF（中文名取自语料里作者自己的表述）-----------------------------
    _e("SOXX", "半导体 ETF", related=("SMH", "SEMI", "SOX")),
    _e("SMH", "半导体 ETF（VanEck）", related=("SOXX", "SEMI", "SOX")),
    _e("SEMI", "全球半导体 ETF", related=("SOXX", "SMH", "SOX")),
    _e("DRAM", "内存/AI 硬件 ETF", note="语料里作为内存/半导体板块的代理"),
    _e("IGV", "软件板块 ETF"),
    _e("MAGS", "七巨头 ETF"),
    _e("XLV", "健康板块 ETF"),
    _e("XLI", "工业板块 ETF"),
    _e("XLU", "公用事业板块 ETF"),
    _e("RSP", "等权重标普500 ETF", related=("SPX",),
       note="语料里用作市场广度代理（等权 vs 市值加权）"),
    _e("MOAT", "宽护城河 ETF"),
    _e("ITA", "国防军工航天 ETF"),
    _e("AAXJ", "亚太除日本 ETF"),
    _e("TLT", "20年期以上美债 ETF"),
    _e("KBWB", "银行板块 ETF"),
    _e("DBA", "农产品 ETF"),
    _e("FCG", "天然气板块 ETF"),
    _e("UFOX", "太空算力主题 ETF"),
    Asset("QQQ", "etf", "纳斯达克100 ETF", instrument="QQQ", related=("NDX",),
          note="可路由可交易，但无知识单元、未采日线"),
    Asset("SPY", "etf", "标普500 ETF", instrument="SPY", related=("SPX",),
          note="可路由可交易，但无知识单元、未采日线"),

    # --- 未上市 -----------------------------------------------------------
    Asset("SPCX", "preipo", "SpaceX", aliases=("SPACEX",), yf="SPCX", instrument="SPCX",
          related=("UFOX",)),

    # --- 个股 -------------------------------------------------------------
    _s("NVDA", "英伟达", instrument="NVDA"),
    _s("AAPL", "苹果", instrument="AAPL"),
    _s("MSFT", "微软", instrument="MSFT"),
    _s("AMZN", "亚马逊", instrument="AMZN"),
    _s("META", "Meta", instrument="META"),
    _s("TSLA", "特斯拉", instrument="TSLA"),
    _s("GOOG", "谷歌 C 类", related=("GOOGL",),
       note="与 GOOGL 是两条不同的 daily_bars 序列，不合并；instruments 在行情路由层"
            "把 GOOG 当 GOOGL 的别名，故这里不给 instrument"),
    _s("GOOGL", "谷歌 A 类", instrument="GOOGL", related=("GOOG",)),
    _s("MU", "美光", instrument="MU"),
    _s("INTC", "英特尔"),
    _s("AMD", "AMD"),
    _s("AVGO", "博通"),
    _s("TSM", "台积电"),
    _s("ASML", "阿斯麦"),
    _s("QCOM", "高通"),
    _s("MRVL", "Marvell"),
    _s("SNDK", "闪迪", instrument="SNDK"),
    _s("CBRS", "Cerebras"),
    _s("NBIS", "Nebius"),
    _s("CRWV", "CoreWeave"),
    _s("ORCL", "甲骨文"),
    _s("CRM", "Salesforce"),
    _s("NOW", "ServiceNow"),
    _s("SNOW", "Snowflake"),
    _s("DDOG", "Datadog"),
    _s("NET", "Cloudflare"),
    _s("OKTA", "Okta"),
    _s("TWLO", "Twilio"),
    _s("TEAM", "Atlassian"),
    _s("PLTR", "Palantir"),
    _s("APP", "AppLovin"),
    _s("PCOR", "Procore"),
    _s("FIG", "Figma"),
    Asset("INTU", "stock", "Intuit",
          note="语料里只有基本面预测（EPS 增速），无价格型判断，故未采日线"),
    _s("NFLX", "奈飞"),
    _s("DIS", "迪士尼"),
    _s("UBER", "Uber"),
    _s("SHOP", "Shopify"),
    _s("V", "Visa"),
    _s("MA", "万事达"),
    _s("PYPL", "PayPal"),
    _s("HOOD", "Robinhood"),
    _s("COIN", "Coinbase", instrument="COIN", related=("BTCUSDT",)),
    _s("CRCL", "Circle", instrument="CRCL"),
    Asset("MSTR", "stock", "Strategy（原 MicroStrategy）", instrument="MSTR",
          related=("BTCUSDT",), note="可路由可交易，但无知识单元、未采日线"),
    _s("VST", "Vistra"),
    _s("CEG", "Constellation Energy"),
    _s("NEE", "NextEra Energy"),
    _s("BE", "Bloom Energy"),
    _s("GE", "通用电气"),
    _s("UNH", "联合健康"),
    _s("ISRG", "直觉外科"),
    _s("NOK", "诺基亚"),
]


# --- 索引与查询 ---------------------------------------------------------------

_BY_ID: dict[str, Asset] = {}
_INDEX: dict[str, Asset] = {}  # 归一化别名 → Asset


def _norm(s: str) -> str:
    return s.strip().upper()


def _build() -> None:
    for a in _ASSETS:
        if a.id in _BY_ID:
            raise ValueError(f"标的 id 重复：{a.id}")
        if a.asset_class not in ASSET_CLASSES:
            raise ValueError(f"{a.id} 的 asset_class 非法：{a.asset_class}")
        _BY_ID[a.id] = a
    for a in _ASSETS:
        for key in (a.id, *a.aliases):
            k = _norm(key)
            if k != a.id and k in _BY_ID:
                raise ValueError(f"{a.id} 的别名 {key} 与另一个标的 id 冲突")
            prev = _INDEX.get(k)
            if prev is not None and prev.id != a.id:
                raise ValueError(f"别名 {key} 同时指向 {prev.id} 与 {a.id}")
            _INDEX[k] = a


_build()


def lookup(symbol: str | None) -> Asset | None:
    """任意拼法 → Asset。认 id、别名、小写标签；认不出返回 None（不抛）。"""
    if not symbol:
        return None
    return _INDEX.get(_norm(symbol))


def resolve_id(symbol: str | None) -> str | None:
    """任意拼法 → 规范 id。认不出返回 None。"""
    a = lookup(symbol)
    return a.id if a else None


def symbol_variants(symbol: str) -> tuple[list[str], list[str]]:
    """任意拼法 → 库里可能出现的写法：`(asset_symbol 候选, 标签候选)`。

    "按标的取单元"必须两路都查：claim 把标的写在 `payload.asset_symbol`，
    method/concept 只有标签——只查前者会把 NVDA 的 24 条认知、SOXX 的 12 条方法全漏掉。
    未登记的符号原样返回，照样能过滤，只是没有别名扩展。
    """
    a = lookup(symbol)
    if a is None:
        raw = (symbol or "").strip()
        return ([raw.upper()], [raw.lower()])
    return (list(dict.fromkeys([a.id, *(_norm(x) for x in a.aliases)])), [a.tag])


def all_assets() -> list[Asset]:
    return list(_ASSETS)


def by_class(asset_class: str) -> list[Asset]:
    return [a for a in _ASSETS if a.asset_class == asset_class]


def exec_candidates(symbol: str) -> list[str]:
    """这个标的的交易记录**可能**被记成哪些符号。

    交易库的 `trades.symbol` 存的是下单时传进去的写法，历史上有三种：加密对
    （`SOL/USDT`）、instruments 的 canonical（`BZ`）、以及执行源上的永续符号
    （`NVDA/USDT:USDT`）。查"这个标的有没有交易过"时三种都要试，所以在这里一次给全。

    这是**查询用的宽匹配**，不是身份声明——别拿它当规范符号用。
    """
    from .data import instruments   # 局部 import：身份表不该在模块级依赖路由表

    a = lookup(symbol)
    if a is None:
        raw = (symbol or "").strip().upper()
        return [raw] if raw else []
    out = [a.id]
    if a.metric_symbol:
        out.append(a.metric_symbol)
    if a.instrument:
        out.append(a.instrument)
        inst = instruments.lookup(a.instrument)
        if inst is not None:
            out.append(inst.provider_symbol)
            if inst.exec_symbol:
                out.append(inst.exec_symbol)
    return list(dict.fromkeys(out))


def yf_symbol_map() -> dict[str, tuple[str, float, str]]:
    """daily_bars 的采集口径：`{asset_symbol: (yfinance ticker, 倍率, 口径备注)}`。

    `knowledge/prices.py` 的 SYMBOL_MAP 从这里派生——**改这里就是改每天的日线采集范围**。
    """
    return {a.id: (a.yf, a.yf_scale, a.yf_note) for a in _ASSETS if a.yf}


def fred_series() -> dict[str, str]:
    """走 FRED 公开 CSV 的序列：`{asset_symbol: 口径说明}`。"""
    return {a.fred: a.yf_note for a in _ASSETS if a.fred}


def metric_symbols() -> dict[str, str]:
    """有全维度指标采集的标的：`{asset_symbol: metric_samples 里的 symbol}`。"""
    return {a.id: a.metric_symbol for a in _ASSETS if a.metric_symbol}
