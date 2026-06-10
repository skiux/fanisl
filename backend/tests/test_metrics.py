"""metric 登记表(SSOT)一致性守护：防止 flatten / backfill / 计算 三处的 metric 名漂移。"""

import numpy as np
import pandas as pd

from analyzer.backfill import indicator_rows
from analyzer.flatten import flatten_snapshot
from analyzer.indicators.compute import indicator_series
from analyzer.metrics import TF_BASES, all_metric_names, catalog, metric_vocab


def _df(n=120):
    rng = pd.date_range("2025-01-01", periods=n, freq="1D", tz="UTC")
    rs = np.random.RandomState(1)
    close = 100 + np.cumsum(rs.normal(0, 1, n))
    return pd.DataFrame({"ts": rng, "open": close, "high": close + 1,
                         "low": close - 1, "close": close, "volume": rs.uniform(50, 150, n)})


def test_indicator_series_keys_match_registry():
    # 计算层产出的 base 必须与登记表的 TF_BASES 完全一致
    assert set(indicator_series(_df()).keys()) == set(TF_BASES)


def test_flatten_names_in_registry(make_snapshot):
    # flatten 落库的每个 metric 名都必须在登记表里（否则就是漂移）
    names = {s.metric for s in flatten_snapshot(make_snapshot())}
    assert names <= all_metric_names(), names - all_metric_names()


def test_backfill_names_in_registry():
    names = {r[2] for r in indicator_rows("BTC/USDT", "1d", _df(), with_price=True)}
    assert names <= all_metric_names(), names - all_metric_names()
    assert "rsi_1d" in names and "price" in names


def test_catalog_shape_and_coverage():
    c = catalog()
    keys = {"name", "category", "unit", "scope", "label", "ts_meaning"}
    assert all(keys <= set(x) for x in c)
    names = {x["name"] for x in c}
    for must in ("rsi_1d", "funding_rate", "spread_bps", "chain_tvl", "fear_greed", "cpi_yoy"):
        assert must in names


def test_metric_vocab_synced():
    v = metric_vocab()
    assert "funding_rate" in v and "cpi_yoy" in v and "taker_buy_sell_ratio" in v
