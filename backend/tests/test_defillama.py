"""DefiLlama 解锁解析的纯逻辑单测（合成 emissions 数据，不联网）。"""

import time

from analyzer.data.defillama_source import _parse_unlocks


def _data(events, max_supply=1000.0):
    return {
        "metadata": {"events": events, "total": max_supply},
        "supplyMetrics": {"maxSupply": max_supply},
    }


def test_parse_unlocks_next_event_and_horizons():
    now = int(time.time())
    events = [
        {"timestamp": now - 86400, "noOfTokens": [50], "category": "past", "unlockType": "cliff"},
        {"timestamp": now + 10 * 86400, "noOfTokens": [10], "category": "team", "unlockType": "cliff"},
        {"timestamp": now + 60 * 86400, "noOfTokens": [20], "category": "investors", "unlockType": "linear"},
        {"timestamp": now + 200 * 86400, "noOfTokens": [100], "category": "x", "unlockType": "cliff"},
    ]
    out = _parse_unlocks("FOO", "foo", _data(events, 1000.0))
    assert out["next_event"]["tokens"] == 10
    assert out["next_event"]["pct_of_max_supply"] == 1.0  # 10/1000*100
    assert out["next_event"]["category"] == "team"
    assert out["next_event"]["type"] == "cliff"
    assert out["next_30d_pct_of_supply"] == 1.0  # 仅 10d 那笔
    assert out["next_90d_pct_of_supply"] == 3.0  # 10+20 在 90d 内


def test_parse_unlocks_no_upcoming():
    now = int(time.time())
    out = _parse_unlocks("FOO", "foo", _data([{"timestamp": now - 86400, "noOfTokens": [5]}]))
    assert out.get("next_event") is None  # 无即将解锁时不含该键，模型 validate 后为 None
    assert out["note"]


def test_parse_unlocks_missing_max_supply_pct_none():
    now = int(time.time())
    data = {"metadata": {"events": [{"timestamp": now + 86400, "noOfTokens": [10]}]}}
    out = _parse_unlocks("FOO", "foo", data)
    assert out["next_event"]["pct_of_max_supply"] is None
