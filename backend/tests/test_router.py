import pytest

from analyzer.data.base import SymbolNotFound
from analyzer.data.instruments import Resolver, lookup


class FakeSource:
    def __init__(self, name, supports_derivatives=False):
        self.name = name
        self.supports_derivatives = supports_derivatives


def make_resolver(with_oanda=True):
    sources = {
        "okx": FakeSource("okx", supports_derivatives=True),
        "polygon": FakeSource("polygon"),
    }
    if with_oanda:
        sources["oanda"] = FakeSource("oanda")
    return Resolver(sources)


def test_lookup_aliases():
    assert lookup("nvda").provider_symbol == "NVDA"
    assert lookup("XAU").provider_symbol == "XAU_USD"
    assert lookup("cl1!").provider_symbol == "CL1!"  # NYMEX WTI 主力 → Polygon
    assert lookup("ndx").provider_symbol == "I:NDX"
    assert lookup("BTC/USDT") is None  # 加密走默认路由，不在登记表


def test_resolve_stock_goes_to_polygon():
    r = make_resolver().resolve("NVDA")
    assert r.source.name == "polygon"
    assert r.provider_symbol == "NVDA"
    assert r.asset_class == "stock"
    assert r.supports_derivatives is False
    assert r.default_timeframes == ["1d", "1wk"]  # Polygon 免费档仅 EOD


def test_resolve_metal_goes_to_oanda():
    r = make_resolver().resolve("XAU")
    assert r.source.name == "oanda"
    assert r.provider_symbol == "XAU_USD"
    assert r.asset_class == "metal"
    assert r.supports_derivatives is False
    assert "4h" in r.default_timeframes  # OANDA 有 H4


def test_resolve_oil_goes_to_polygon():
    r = make_resolver().resolve("CL")
    assert r.source.name == "polygon"
    assert r.provider_symbol == "CL1!"


def test_resolve_crypto_defaults_to_okx_with_derivatives():
    r = make_resolver().resolve("btcusdt")
    assert r.source.name == "okx"
    assert r.provider_symbol == "BTC/USDT"
    assert r.asset_class == "crypto"
    assert r.supports_derivatives is True
    assert r.default_timeframes == ["1h", "4h", "1d"]


def test_resolve_metal_without_oanda_raises():
    with pytest.raises(SymbolNotFound):
        make_resolver(with_oanda=False).resolve("XAU")
