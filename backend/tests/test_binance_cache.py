"""缓存层的降级语义：一个来源出什么错，都只降级它自己。"""

import pytest

from fanisl.binance.cache import SourceCache, fetch


@pytest.fixture
def cache(pool):
    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_cache")
    return SourceCache(pool)


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
