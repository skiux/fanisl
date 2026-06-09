from analyzer.config import Settings
from analyzer.data.factory import build_resolver


def test_build_resolver_routes_each_asset_class():
    # 不联网：构造源 + 路由不触发取数
    r = build_resolver(Settings(polygon_api_key="", oanda_api_token=""))
    assert r.resolve("NVDA").source.name == "polygon"
    assert r.resolve("XAU").source.name == "oanda"
    assert r.resolve("CL").source.name == "polygon"
    crypto = r.resolve("BTC/USDT")
    assert crypto.source.name == "binance"  # 默认所已切到 Binance
    assert crypto.supports_derivatives is True
