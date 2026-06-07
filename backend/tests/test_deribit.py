"""Deribit 期权聚合的纯逻辑单测（合成 book summary，不联网）。"""

from analyzer.data.deribit_source import (
    _iv_skew,
    _max_pain,
    _parse_instrument,
    _summarize,
)


def test_parse_instrument():
    assert _parse_instrument("BTC-27JUN25-100000-C") == ("27JUN25", 100000.0, "C")
    assert _parse_instrument("BTC-DVOL") is None
    assert _parse_instrument("BTC-27JUN25-100000-X") is None


def _row(name, oi, iv, underlying=60000.0):
    return {
        "instrument_name": name,
        "open_interest": oi,
        "mark_iv": iv,
        "underlying_price": underlying,
    }


def test_summarize_pcr_and_dominant_expiry():
    rows = [
        _row("BTC-27JUN26-60000-C", 100, 50),
        _row("BTC-27JUN26-60000-P", 200, 55),  # 看跌 OI 多
        _row("BTC-26DEC26-80000-C", 10, 60),  # 远月 OI 小 → 非主力
    ]
    s = _summarize(rows)
    assert s["put_call_oi_ratio"] == round(200 / 110, 3)
    assert s["nearest_expiry"] == "27JUN26"  # OI 最大的到期
    assert s["underlying_price"] == 60000.0
    assert s["total_oi_contracts"] == 310.0


def test_max_pain_minimizes_holder_payout():
    # 看涨堆在 50k、看跌堆在 70k；最大痛点应落在中间区域使总内在价值最小
    contracts = [
        {"strike": 50000.0, "kind": "C", "oi": 100},
        {"strike": 70000.0, "kind": "P", "oi": 100},
        {"strike": 60000.0, "kind": "C", "oi": 5},
        {"strike": 60000.0, "kind": "P", "oi": 5},
    ]
    assert _max_pain(contracts) == 60000.0


def test_iv_skew_put_more_expensive_is_positive():
    underlying = 60000.0
    contracts = [
        {"strike": 54000.0, "kind": "P", "oi": 10, "iv": 65.0},  # ~10% OTM put
        {"strike": 66000.0, "kind": "C", "oi": 10, "iv": 55.0},  # ~10% OTM call
    ]
    assert _iv_skew(contracts, underlying) == 10.0  # 下行保护更贵


def test_summarize_empty_returns_none():
    assert _summarize([]) is None
    assert _summarize([{"instrument_name": "BTC-DVOL", "open_interest": 0}]) is None
