"""缓存层的降级语义：一个来源出什么错，都只降级它自己。"""

from decimal import Decimal

import pytest

from fanisl.binance.cache import SourceCache, fetch


@pytest.fixture
def cache(pool):
    cache = SourceCache(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_spot_costs, binance_stock_costs, binance_cache")
    return cache


def _unexpected():
    raise ValueError("unexpected shape")


def test_unexpected_exception_becomes_a_source_failure(cache):
    """原先只接 `BinanceError`，别的异常穿出 `fetch_all`，整页 500（2026-09-17）。"""
    got = fetch(cache, "demo", 60, _unexpected)
    assert got.status == "unreachable"
    assert got.payload is None
    assert "ValueError" in got.detail


def test_unexpected_exception_still_serves_the_previous_data(cache):
    fresh = fetch(cache, "demo", 60, lambda: {"balance": "1"})
    stale = fetch(cache, "demo", 60, _unexpected, force=True)
    assert stale.payload == {"balance": "1"}
    assert stale.status == "unreachable"
    assert stale.as_of == fresh.as_of


def test_stock_cost_is_persisted_and_updated_per_symbol(cache):
    first = cache.upsert_stock_cost(
        "soxl", Decimal("1000"), Decimal("0.40"), Decimal("40"), 7)

    assert first["symbol"] == "SOXL"
    assert first["cost_price_usd"] == Decimal("1000")
    assert first["commission_usd"] == Decimal("0.40")
    assert first["position_qty"] == Decimal("40")
    assert first["updated_by"] == 7
    assert first["updated_at"].utcoffset() is not None

    cache.upsert_stock_cost(
        "SOXL", Decimal("980"), Decimal("0.55"), Decimal("40"), 8)
    rows = cache.stock_costs()

    assert list(rows) == ["SOXL"]
    assert rows["SOXL"]["cost_price_usd"] == Decimal("980")
    assert rows["SOXL"]["commission_usd"] == Decimal("0.55")
    assert rows["SOXL"]["updated_by"] == 8


def test_spot_cost_is_persisted_separately_from_stocks(cache):
    first = cache.upsert_spot_cost(
        "btc", Decimal("2000"), Decimal("2"), Decimal("0.1"), 7)
    assert first["asset"] == "BTC"
    assert first["position_qty"] == Decimal("0.1")
    cache.upsert_spot_cost("BTC", Decimal("2100"), Decimal("0"), Decimal("0.1"), 8)
    assert cache.spot_costs()["BTC"]["cost_price_usd"] == Decimal("2100")
    assert cache.spot_costs()["BTC"]["updated_by"] == 8
    assert cache.stock_costs() == {}


def test_legacy_whole_position_values_are_not_misread_as_unit_prices(cache):
    with cache.pool.connection() as conn:
        conn.execute(
            "INSERT INTO binance_stock_costs "
            "(symbol, trade_value_usd, commission_usd, position_qty, updated_by) "
            "VALUES ('SOXL', 920, 4, 40, 7)"
        )
        conn.execute(
            "INSERT INTO binance_spot_costs "
            "(asset, trade_value_usd, commission_usd, position_qty, updated_by) "
            "VALUES ('BNB', 900, 3, 1.5, 7)"
        )
    assert cache.stock_costs() == {}
    assert cache.spot_costs() == {}
