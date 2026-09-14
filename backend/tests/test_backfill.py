"""回填纯函数测试：历史 OHLCV → 指标样本行（不联网）。"""

import numpy as np
import pandas as pd

from fanisl.collect.backfill import indicator_rows


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
    # **戳在 bar 收盘时刻**(开盘+1d)——收盘派生值在开盘时未知，按开盘打戳曾造成 lookahead 污染
    one_day = pd.Timedelta(days=1)
    last_closed_close_ts = (df["ts"].iloc[-2] + one_day).isoformat()
    assert any(r[3] == last_closed_close_ts for r in rows)
    all_ts = {r[3] for r in rows}
    assert (df["ts"].iloc[-1] + one_day).isoformat() not in all_ts  # 未收盘那根不写
    # 预热段(前 35 根)丢掉：最早落库点应是第 35 根的收盘
    price_ts = sorted(r[3] for r in rows if r[2] == "price")
    assert price_ts[0] == (df["ts"].iloc[35] + one_day).isoformat()


def test_no_price_when_flag_off():
    rows = indicator_rows("BTC/USDT", "4h", _df(), with_price=False)
    assert "price" not in {r[2] for r in rows}
    assert "rsi_4h" in {r[2] for r in rows}


def test_too_short_returns_empty():
    assert indicator_rows("BTC/USDT", "1d", _df(20), with_price=True) == []


def test_backfill_global_writes_every_fred_series():
    """全市场那一段只在配了 FRED key 时才跑，且排在逐标的回填全部写完之后。

    包分组（2026-09-10）时这里的相对导入漏改，还是 `.data.fred_source`，指向并不存在的
    `fanisl.collect.data`——测试一直是绿的，真跑回填才会在最后一步 ModuleNotFoundError。
    """
    from fanisl.collect.backfill import backfill_global
    from fanisl.data.fred_source import FRED_SERIES

    class Store:
        def __init__(self):
            self.rows = []

        def write_history(self, rows):
            self.rows.extend(rows)
            return len(rows)

    class Macro:  # 只要有 fetch_series_history 就会走宏观分支；不联网
        def fetch_series_history(self, series_id, units):
            return [{"ts": "2026-01-01T00:00:00+00:00", "value": 1.0}]

    class Catalysts:
        macro = Macro()

    store = Store()
    assert backfill_global(store, sentiment=None, catalysts=Catalysts()) == len(FRED_SERIES)
    assert {r[2] for r in store.rows} == {metric for _sid, metric, _units in FRED_SERIES}
    assert all(r[:2] == ("global", "GLOBAL") for r in store.rows)
