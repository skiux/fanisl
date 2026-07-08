"""Playbook 层测试：探测器纯函数 / 计划模板构造 / 注册表（不碰 DB、不联网）。"""

from datetime import datetime, timedelta, timezone

import pytest

from analyzer.trading import playbook
from analyzer.trading.playbook import (
    BacktestPrior,
    SetupSpec,
    build_plan,
    daily_atr_proxy,
    tsmom_signal,
)

NOW = datetime(2026, 7, 8, 12, 0, tzinfo=timezone.utc)


def _hourly(prices: list[float], end: datetime = NOW) -> list[tuple[datetime, float]]:
    """构造升序小时价序列，最后一个点落在 end。"""
    start = end - timedelta(hours=len(prices) - 1)
    return [(start + timedelta(hours=i), p) for i, p in enumerate(prices)]


def _spec(**over) -> SetupSpec:
    base = dict(
        key="test_setup", name="测试", hypothesis_ref="H0", status="candidate",
        symbols=["BTC/USDT"], risk_pct=0.5, leverage=2.0,
        sl_atr_mult=3.0, tp_atr_mult=6.0, holding_hours=168.0, cooldown_hours=168.0,
        prior=BacktestPrior(n=100, hit_rate=0.55, avg_net_return=0.01, ci_low=0.002,
                            holding_hours=168.0, source="doc/x.md", regime_notes="-"),
    )
    base.update(over)
    return SetupSpec.model_validate(base)


# --- tsmom_signal -----------------------------------------------------------

def test_tsmom_long_when_7d_return_positive():
    # 台阶在最近 7d 窗口内（99h 前）：7d 前的 asof=100，当前=110 → long
    pts = _hourly([100.0] * 300 + [110.0] * 100)
    sig = tsmom_signal(pts, NOW)
    assert sig is not None and sig.side == "long"
    assert sig.ref_price == 110.0
    assert sig.features["ret_lookback"] == pytest.approx(0.1, rel=0.01)


def test_tsmom_short_when_7d_return_negative():
    pts = _hourly([100.0] * 300 + [88.0] * 100)
    sig = tsmom_signal(pts, NOW)
    assert sig is not None and sig.side == "short"


def test_tsmom_none_when_price_stale():
    # 最新价停在 3 小时前（> 新鲜度上限 2h）→ 不触发
    pts = _hourly([100.0] * 300 + [120.0] * 100, end=NOW - timedelta(hours=3))
    assert tsmom_signal(pts, NOW) is None


def test_tsmom_none_when_history_too_short():
    pts = _hourly([100.0, 105.0, 110.0])  # 不足 7d 回看
    assert tsmom_signal(pts, NOW) is None
    assert tsmom_signal([], NOW) is None


# --- daily_atr_proxy --------------------------------------------------------

def test_daily_atr_proxy_mean_abs_daily_move():
    # 每天恒涨 2：|close(t) − close(t−24h)| = 48（每小时 +2 → 24h 共 48）
    pts = _hourly([100.0 + 2 * i for i in range(400)])
    atr = daily_atr_proxy(pts, NOW)
    assert atr == pytest.approx(48.0, rel=0.01)


def test_daily_atr_proxy_none_when_insufficient():
    pts = _hourly([100.0] * 48)  # 只有 2 天，凑不满 5 个日样本
    assert daily_atr_proxy(pts, NOW) is None


# --- build_plan -------------------------------------------------------------

def test_build_plan_long_uses_atr_template():
    sig = playbook.SetupSignal(side="long", ref_price=100.0, atr_daily=2.0, features={"x": 1})
    plan = build_plan(_spec(), "BTC/USDT", sig)
    assert plan.setup_key == "test_setup" and plan.side == "long"
    assert plan.entry_price == 100.0
    assert plan.sl_price == pytest.approx(94.0)    # 100 − 3×2
    assert plan.tp_targets[0].price == pytest.approx(112.0)  # 100 + 6×2
    assert plan.time_exit_hours == 168.0
    assert plan.risk_pct == 0.5 and plan.leverage == 2.0
    assert plan.mtf is None  # 机器计划不伪造酌情分析


def test_build_plan_short_flips_levels():
    sig = playbook.SetupSignal(side="short", ref_price=100.0, atr_daily=2.0)
    plan = build_plan(_spec(), "BTC/USDT", sig)
    assert plan.sl_price == pytest.approx(106.0)
    assert plan.tp_targets[0].price == pytest.approx(88.0)


def test_build_plan_fallback_when_no_atr():
    sig = playbook.SetupSignal(side="long", ref_price=100.0, atr_daily=None)
    plan = build_plan(_spec(sl_fallback_pct=10.0), "BTC/USDT", sig)
    assert plan.sl_price == pytest.approx(90.0)    # 兜底 10%
    assert plan.tp_targets[0].price == pytest.approx(120.0)  # 保持 tp/sl 比例(6/3)


# --- 注册表 -----------------------------------------------------------------

def test_registry_h7_candidate_present():
    h7 = playbook.get_setup("tsmom_7d")
    assert h7 is not None and h7.status == "candidate"
    assert h7.hypothesis_ref == "H7"
    assert any(s.key == "tsmom_7d" for s in playbook.active_setups())


def test_registry_retired_excluded_and_register_roundtrip():
    spec = _spec(key="tmp_retired", status="retired")
    playbook.register(spec, lambda pool, sym, now: None)
    try:
        assert all(s.key != "tmp_retired" for s in playbook.active_setups())
        assert playbook.get_setup("tmp_retired") is not None
    finally:
        playbook.unregister("tmp_retired")
    assert playbook.get_setup("tmp_retired") is None
