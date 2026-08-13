"""联赛表显著性口径：市场基线 + Poisson-binomial（不联网、不碰库）。"""

import math

import pytest

from analyzer.knowledge.league import base_rate, poisson_binomial_tail


# --- Poisson-binomial ------------------------------------------------------

def test_poisson_binomial_reduces_to_binomial_when_all_p_equal():
    """各次概率都是 0.5 时应与普通二项完全一致——退化情形的正确性锚点。"""
    n, k = 10, 7
    ps = [0.5] * n
    expect = sum(math.comb(n, i) for i in range(k, n + 1)) / 2 ** n
    assert poisson_binomial_tail(k, ps, upper=True) == pytest.approx(expect)


def test_poisson_binomial_tails_sum_to_one_at_split():
    ps = [0.3, 0.6, 0.8, 0.45]
    k = 2
    lo = poisson_binomial_tail(k - 1, ps, upper=False)   # P(X≤1)
    hi = poisson_binomial_tail(k, ps, upper=True)        # P(X≥2)
    assert lo + hi == pytest.approx(1.0)


def test_higher_baseline_makes_same_record_less_significant():
    """同样 8/10，基线越高越不显著——这正是 50% 基线在上行市里高估显著性的机制。"""
    at_half = poisson_binomial_tail(8, [0.5] * 10, upper=True)
    at_drift = poisson_binomial_tail(8, [0.7] * 10, upper=True)
    assert at_drift > at_half


def test_certain_outcomes_do_not_break_dp():
    assert poisson_binomial_tail(1, [0.0, 1.0], upper=True) == pytest.approx(1.0)
    assert poisson_binomial_tail(2, [0.0, 1.0], upper=True) == pytest.approx(0.0)


# --- 市场基线 ---------------------------------------------------------------

def _ramp(n, step=0.01):
    """单调上行序列：任何长度的窗口都在涨。"""
    out, v = [], 100.0
    for _ in range(n):
        out.append(v)
        v *= 1 + step
    return out


def test_base_rate_up_is_one_in_a_monotonic_uptrend():
    assert base_rate(_ramp(60), 7, "up") == pytest.approx(1.0)


def test_base_rate_down_is_zero_in_a_monotonic_uptrend():
    assert base_rate(_ramp(60), 7, "down") == pytest.approx(0.0)


def test_base_rate_mirrors_scorer_semantics_for_ref_factor():
    """up + ref_factor=0.95 判的是"跌幅不超过 5%"，在缓跌序列里应显著高于纯 up。"""
    closes = [100.0 * (0.999 ** i) for i in range(60)]   # 每日 -0.1%，7 日约 -0.7%
    assert base_rate(closes, 7, "up") == pytest.approx(0.0)
    assert base_rate(closes, 7, "up", factor=0.95) == pytest.approx(1.0)


def test_base_rate_flat_uses_band():
    closes = [100.0 * (1.0005 ** i) for i in range(60)]  # 7 日约 +0.25%
    assert base_rate(closes, 7, "flat", band=0.02) == pytest.approx(1.0)
    assert base_rate(closes, 7, "flat", band=0.001) == pytest.approx(0.0)


def test_base_rate_none_when_too_few_windows():
    assert base_rate([100.0] * 5, 30, "up") is None      # 窗口比序列还长
    assert base_rate(_ramp(9), 7, "up") is None          # 重叠窗口数不足下限
    assert base_rate([], 7, "up") is None


def test_base_rate_window_converts_calendar_days_to_trading_days():
    """7 自然日 ≈ 5 交易日：序列刚好 6 根时够算 1 个窗口，但少于下限→None。"""
    assert base_rate(_ramp(6), 7, "up") is None
    assert base_rate(_ramp(30), 7, "up") is not None
