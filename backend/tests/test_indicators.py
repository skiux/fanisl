import pandas as pd
import pytest

from analyzer.indicators.compute import compute_indicators


def make_df(closes: list[float]) -> pd.DataFrame:
    rows = [
        {
            "ts": pd.Timestamp("2024-01-01", tz="UTC") + pd.Timedelta(hours=i),
            "open": c,
            "high": c + 1,
            "low": c - 1,
            "close": c,
            "volume": 100.0,
        }
        for i, c in enumerate(closes)
    ]
    return pd.DataFrame(rows)


def test_uptrend_rsi_and_levels():
    df = make_df([float(x) for x in range(100, 160)])  # 60 根，严格上涨
    ind = compute_indicators(df)
    # 末根（未收盘）被丢弃：last_price 仍是实时价 159，但指标用已收盘的前 59 根
    assert ind.last_price == 159.0
    assert ind.rsi == 100.0  # 已收盘段全是上涨 → RSI=100
    assert ind.recent_swing_high == 159.0  # 已收盘近20根最高 high = 158+1
    assert ind.recent_swing_low == 138.0  # 已收盘近20根最低 low = 139-1
    assert ind.ema20 <= ind.last_price
    assert ind.change_pct > 0


def test_too_few_rows_raises():
    with pytest.raises(ValueError):
        compute_indicators(make_df([1.0] * 10))
