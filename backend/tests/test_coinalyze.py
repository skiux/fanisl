"""Coinalyze 爆仓聚合的纯逻辑单测（合成 history，不联网）。"""

from analyzer.data.coinalyze_source import _aggregate


def test_aggregate_sums_across_symbols_and_marks_side():
    data = [
        {"symbol": "BTCUSDT_PERP.A", "history": [
            {"t": 1, "l": 1000.0, "s": 100.0},
            {"t": 2, "l": 2000.0, "s": 200.0},
        ]},
        {"symbol": "BTCUSD_PERP.6", "history": [
            {"t": 1, "l": 500.0, "s": 50.0},
        ]},
    ]
    out = _aggregate(data)
    assert out["long_usd_24h"] == 3500.0
    assert out["short_usd_24h"] == 350.0
    assert out["total_usd_24h"] == 3850.0
    assert out["dominant_side"] == "long"  # 多头被爆远多于空头


def test_aggregate_balanced_when_close():
    data = [{"symbol": "X", "history": [{"t": 1, "l": 100.0, "s": 95.0}]}]
    out = _aggregate(data)
    assert out["dominant_side"] == "balanced"  # 差额 <15%


def test_aggregate_detects_spike():
    # 前几桶都很小，最后一桶骤增 → 尖峰
    hist = [{"t": i, "l": 10.0, "s": 10.0} for i in range(1, 5)]
    hist.append({"t": 5, "l": 500.0, "s": 500.0})
    out = _aggregate([{"symbol": "X", "history": hist}])
    assert out["recent_spike"] is True


def test_aggregate_empty_returns_none():
    assert _aggregate([]) is None
    assert _aggregate([{"symbol": "X", "history": [{"t": 1, "l": 0, "s": 0}]}]) is None
