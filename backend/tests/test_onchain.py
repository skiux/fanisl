"""链上数据（Part 4）纯逻辑单测：解析 + builder（不联网）。"""

from analyzer.data.blockchaininfo_source import _change_7d, _last
from analyzer.data.defillama_source import _parse_chain_tvl, _parse_stablecoins
from analyzer.snapshot.builder import build_onchain


def _peg(now, week, month):
    return {
        "circulating": {"peggedUSD": now},
        "circulatingPrevWeek": {"peggedUSD": week},
        "circulatingPrevMonth": {"peggedUSD": month},
    }


def test_parse_stablecoins_sums_and_changes():
    assets = [_peg(60, 50, 40), _peg(40, 50, 60)]  # total now=100, week=100, month=100
    out = _parse_stablecoins(assets)
    assert out["total_usd"] == 100
    assert out["change_7d_pct"] == 0.0
    assert out["change_30d_pct"] == 0.0


def test_parse_stablecoins_growth():
    out = _parse_stablecoins([_peg(110, 100, 100)])
    assert out["change_7d_pct"] == 10.0
    assert out["change_30d_pct"] == 10.0


def test_parse_stablecoins_empty_none():
    assert _parse_stablecoins([]) is None


def test_parse_chain_tvl_30d_change():
    hist = [{"date": i, "tvl": 1000} for i in range(40)]
    hist[-1]["tvl"] = 1200  # now
    hist[-31]["tvl"] = 1000  # 30d ago
    out = _parse_chain_tvl("Solana", hist)
    assert out["chain"] == "Solana"
    assert out["tvl_usd"] == 1200
    assert out["change_30d_pct"] == 20.0


def test_parse_chain_tvl_empty_none():
    assert _parse_chain_tvl("X", []) is None


def test_blockchaininfo_helpers():
    vals = [{"x": i, "y": 100.0 + i} for i in range(10)]  # last=109, 8th-from-last=102
    assert _last(vals) == 109.0
    assert _change_7d(vals) == round((109 - 102) / 102 * 100, 2)
    assert _last(None) is None
    assert _change_7d([{"x": 1, "y": 5}]) is None  # 不足 8 点


def test_build_onchain_partial_and_none():
    oc = build_onchain({"total_usd": 100.0}, None, None)
    assert oc.stablecoins.total_usd == 100.0
    assert oc.chain_tvl is None
    assert build_onchain(None, None, None) is None
