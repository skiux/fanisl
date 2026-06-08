"""入库前取值校验单测（纯函数，不联网）。"""

import math

from analyzer.marketstore import GLOBAL, Sample
from analyzer.validate import clean_samples


def _s(metric, value, symbol="BTC/USDT", scope="symbol"):
    return Sample(scope, symbol, metric, value)


def test_rejects_non_finite():
    good, bad = clean_samples([_s("price", math.nan), _s("rsi_1h", math.inf), _s("price", 100.0)])
    assert [s.value for s in good] == [100.0]
    assert len(bad) == 2


def test_rsi_range():
    good, bad = clean_samples([_s("rsi_1h", 55.0), _s("rsi_1d", 150.0), _s("rsi_4h", -1.0)])
    assert [s.metric for s in good] == ["rsi_1h"]
    assert len(bad) == 2


def test_percentile_0_1():
    good, bad = clean_samples([
        _s("funding_percentile", 0.9),
        _s("lsr_percentile", 1.4),       # 越界
        _s("atr_pct_1h", 0.3),
        _s("atr_pct_4h", -0.1),          # 越界
    ])
    assert {s.metric for s in good} == {"funding_percentile", "atr_pct_1h"}
    assert len(bad) == 2


def test_nonneg_quantities():
    good, bad = clean_samples([
        _s("open_interest_usd", -5.0),   # 金额不可能为负
        _s("lsr", -1.0),                 # 比率不可能为负
        _s("active_addresses", 1200.0),
    ])
    assert [s.metric for s in good] == ["active_addresses"]
    assert len(bad) == 2


def test_signed_metrics_allow_negative():
    # 可正可负的量只查有限性、不限范围
    good, bad = clean_samples([
        _s("funding_rate", -0.0003),
        _s("basis_perp", -0.5),
        _s("change_pct_1h", -8.0),
        _s("macd_hist_1d", -12.0),
        _s("fear_greed", 20.0, symbol=GLOBAL, scope="global"),
    ])
    assert len(good) == 5 and bad == []
