"""标的登记表（analyzer.assets）的守护测试。

两件事必须钉死：
1. **日线采集范围不许被顺手改掉**——SYMBOL_MAP 现在派生自登记表，登记表多一行就等于
   每天多拉一个符号。这里冻一份当前口径的快照，有意增减时才改这个测试。
2. **三张表不许漂移**——登记表(身份) / instruments(路由) / prices(日线) 必须互相解析得到。
"""

import pytest

from analyzer import assets
from analyzer.data import instruments
from analyzer.knowledge import prices

# --- 冻结：daily_bars 的采集口径（2026-08-29 快照，85 个符号）------------------

# 非同名映射（代理关系/指数代码），逐条写死
_EXPLICIT_YF = {
    "XAUUSD": ("GC=F", 1.0, "COMEX 金期货近月代理现货"),
    "XAGUSD": ("SI=F", 1.0, "COMEX 银期货近月代理现货"),
    "WTI": ("CL=F", 1.0, "NYMEX WTI 期货近月"),
    "NDX": ("^NDX", 1.0, ""),
    "SPX": ("^GSPC", 1.0, ""),
    "DJI": ("^DJI", 1.0, ""),
    "SOX": ("^SOX", 1.0, "费城半导体指数"),
    "KOSPI": ("^KS11", 1.0, ""),
    "DXY": ("DX-Y.NYB", 1.0, "ICE 美元指数"),
    "AUDJPY": ("AUDJPY=X", 1.0, ""),
    "US10Y": ("^TNX", 1.0, "收益率%（yfinance 直读口径，实测 2026-05 为 4.48）"),
    "US30Y": ("^TYX", 1.0, "收益率%（直读口径）"),
    "BTCUSDT": ("BTC-USD", 1.0, "现货指数代理"),
    "VIX": ("^VIX", 1.0, "CBOE 波动率指数"),
    "GSCI": ("^SPGSCI", 1.0, "标普高盛商品指数（能源权重约 40%）"),
}

# 与 id 同名的（yfinance ticker 就是符号本身）
_SELF_YF = {
    "AAPL", "AAXJ", "AMD", "AMZN", "APP", "ASML", "AVGO", "BE", "CBRS", "CEG", "COIN",
    "CRCL", "CRM", "CRWV", "DBA", "DDOG", "DIS", "DRAM", "FCG", "FIG", "GE", "GOOG",
    "GOOGL", "HOOD", "IGV", "INTC", "ISRG", "ITA", "KBWB", "MA", "MAGS", "META", "MOAT",
    "MRVL", "MSFT", "MU", "NBIS", "NEE", "NET", "NFLX", "NOK", "NOW", "NVDA", "OKTA",
    "ORCL", "PCOR", "PLTR", "PYPL", "QCOM", "RSP", "SEMI", "SHOP", "SMH", "SNDK", "SNOW",
    "SOXX", "SPCX", "TEAM", "TLT", "TSLA", "TSM", "TWLO", "UBER", "UFOX", "UNH", "V",
    "VST", "XLI", "XLU", "XLV",
}

_EXPECTED_FRED = {"DFEDTARU", "T10Y2Y"}


def test_daily_bar_coverage_matches_frozen_snapshot():
    """登记表导出的日线口径 == 冻结快照。增减符号是有意决定，改代码时同步改这里。"""
    expected = dict(_EXPLICIT_YF)
    expected.update({s: (s, 1.0, "") for s in _SELF_YF})
    assert assets.yf_symbol_map() == expected
    assert set(assets.fred_series()) == _EXPECTED_FRED


def test_prices_module_reexports_the_registry():
    """prices.SYMBOL_MAP / FRED_SERIES 是登记表的派生视图，不是第二份登记。"""
    assert prices.SYMBOL_MAP == assets.yf_symbol_map()
    assert prices.FRED_SERIES == assets.fred_series()


# --- 身份与解析 ---------------------------------------------------------------

def test_ids_are_url_safe():
    """id 直接进 `/assets/{id}` 与前端 `#/asset/{id}`，不能带斜杠或空白。"""
    for a in assets.all_assets():
        assert a.id == a.id.strip().upper()
        assert "/" not in a.id and " " not in a.id


def test_aliases_resolve_across_namespaces():
    """五套拼法都要落到同一个 id。"""
    assert assets.resolve_id("XAU/USD") == "XAUUSD"      # instruments canonical
    assert assets.resolve_id("xauusd") == "XAUUSD"       # 标签
    assert assets.resolve_id("GOLD") == "XAUUSD"         # 口语别名
    assert assets.resolve_id("CL") == "WTI"              # instruments 用 CL，知识库用 WTI
    assert assets.resolve_id("BTC/USDT") == "BTCUSDT"    # metric_samples 拼法
    assert assets.resolve_id("  ndx ") == "NDX"
    assert assets.resolve_id("查无此物") is None
    assert assets.resolve_id(None) is None


def test_tag_is_lowercased_id():
    """提取规范 §7：资产标签 = 规范符号小写。"""
    assert assets.lookup("NVDA").tag == "nvda"
    assert assets.lookup("XAU/USD").tag == "xauusd"


def test_google_share_classes_stay_separate():
    """GOOG 与 GOOGL 在 daily_bars 里是两条不同的序列，登记表不许合并。"""
    assert assets.resolve_id("GOOG") == "GOOG"
    assert assets.resolve_id("GOOGL") == "GOOGL"
    assert assets.lookup("GOOG").yf == "GOOG"
    assert assets.lookup("GOOGL").yf == "GOOGL"
    assert "GOOGL" in assets.lookup("GOOG").related


def test_unpriceable_assets_are_registered_without_a_bar_source():
    """已核无日线源的标的仍要在登记表里（页面要能解释"为什么没有价格证据图"）。"""
    for sym in ("HSTECH", "INTU", "BZ"):
        a = assets.lookup(sym)
        assert a is not None and a.yf is None
        assert a.note, f"{sym} 无日线源，必须写明原因"


# --- 与 instruments.py（路由表）的一致性 --------------------------------------

def test_every_routable_instrument_resolves_to_an_asset():
    for canonical in instruments.tradeable_canonicals():
        assert assets.resolve_id(canonical) is not None, f"{canonical} 不在标的登记表里"


def test_declared_instrument_links_point_at_real_routes():
    for a in assets.all_assets():
        if a.instrument is None:
            continue
        inst = instruments.lookup(a.instrument)
        assert inst is not None, f"{a.id} 声明的 instrument={a.instrument} 在路由表里不存在"
        assert inst.canonical == a.instrument


def test_metric_symbols_cover_the_collector_watchlist():
    """有全维度指标的标的 = 采集 watchlist。少一个，标的页的"数据覆盖"就会说谎。"""
    from analyzer.config import Settings

    watchlist = set(Settings().watchlist)
    assert set(assets.metric_symbols().values()) == watchlist


# --- 登记表自身的完整性（构建期已断言，这里守住断言本身有效）------------------

def test_registry_rejects_conflicting_aliases():
    a = assets.Asset("ZZZTEST", "stock", aliases=("NVDA",))
    saved = assets._ASSETS
    try:
        assets._ASSETS = [*saved, a]
        assets._BY_ID.clear()
        assets._INDEX.clear()
        with pytest.raises(ValueError):
            assets._build()
    finally:
        assets._ASSETS = saved
        assets._BY_ID.clear()
        assets._INDEX.clear()
        assets._build()
