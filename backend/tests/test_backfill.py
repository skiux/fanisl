"""回填纯函数测试：历史 OHLCV → 指标样本行（不联网）。"""

import numpy as np
import pandas as pd

from analyzer.backfill import indicator_rows


def _df(n=300):
    rng = pd.date_range("2025-01-01", periods=n, freq="1D", tz="UTC")
    rs = np.random.RandomState(0)
    close = 100 + np.cumsum(rs.normal(0, 1, n))
    return pd.DataFrame({
        "ts": rng, "open": close, "high": close + 1, "low": close - 1,
        "close": close, "volume": rs.uniform(50, 150, n),
    })


def test_indicator_rows_emits_suffixed_metrics():
    df = _df()
    rows = indicator_rows("BTC/USDT", "1d", df, with_price=True)
    metrics = {r[2] for r in rows}
    assert {"rsi_1d", "macd_hist_1d", "atr_1d", "atr_pct_1d", "vol_ratio_1d",
            "bb_upper_1d", "bb_lower_1d", "change_pct_1d", "price"} <= metrics
    # 都是 symbol scope，ts 是 ISO 字符串，丢了最后一根未收盘
    assert all(r[0] == "symbol" and r[1] == "BTC/USDT" for r in rows)
    assert all("T" in r[3] for r in rows)
    last_closed_ts = df["ts"].iloc[-2].isoformat()
    assert any(r[3] == last_closed_ts for r in rows)
    assert df["ts"].iloc[-1].isoformat() not in {r[3] for r in rows}  # 未收盘那根不写
    # 预热段(前 35 根)丢掉：最早落库点应是第 35 根
    price_ts = sorted(r[3] for r in rows if r[2] == "price")
    assert price_ts[0] == df["ts"].iloc[35].isoformat()


def test_no_price_when_flag_off():
    rows = indicator_rows("BTC/USDT", "4h", _df(), with_price=False)
    assert "price" not in {r[2] for r in rows}
    assert "rsi_4h" in {r[2] for r in rows}


def test_too_short_returns_empty():
    assert indicator_rows("BTC/USDT", "1d", _df(20), with_price=True) == []
