"""交易确定性数学单测（纯函数，不联网/不碰 DB）。"""

from analyzer.trading.calc import (
    apply_slippage,
    fee,
    liquidation_price,
    margin_required,
    pnl,
    position_size,
    reward_risk,
    validate_plan,
)
from analyzer.trading.models import TpTarget


def test_position_size_from_risk():
    # 权益 1万、风险 1% = 100；止损距离 5 → 数量 20
    assert position_size(10_000, 1.0, 100.0, 95.0) == 20.0


def test_margin_and_fee():
    assert margin_required(20.0, 100.0, 10.0) == 200.0  # 名义 2000 / 10x
    assert fee(2000.0, 5.0) == 1.0  # 5bp


def test_reward_risk_weighted():
    tps = [TpTarget(price=110, reduce_pct=50), TpTarget(price=120, reduce_pct=50)]
    # risk=5；reward=0.5*10+0.5*20=15 → 3.0
    assert reward_risk(100.0, 95.0, tps, "long") == 3.0
    # 只配 50%，剩余 50% 持有到最后目标(110) → reward=0.5*10+0.5*10=10 → 2.0
    assert reward_risk(100.0, 95.0, [TpTarget(price=110, reduce_pct=50)], "long") == 2.0


def test_liquidation_price():
    assert liquidation_price(100.0, 10.0, "long") == 90.5   # (0.1-0.005)
    assert liquidation_price(100.0, 10.0, "short") == 109.5


def test_pnl_signed():
    assert pnl("long", 100.0, 110.0, 20.0) == 200.0
    assert pnl("short", 100.0, 90.0, 20.0) == 200.0
    assert pnl("long", 100.0, 90.0, 20.0) == -200.0


def test_slippage_always_adverse():
    assert apply_slippage(100.0, "long", 2.0, is_entry=True) == 100.02   # 进多=买入偏高
    assert apply_slippage(100.0, "long", 2.0, is_entry=False) == 99.98   # 平多=卖出偏低
    assert apply_slippage(100.0, "short", 2.0, is_entry=True) == 99.98   # 进空=卖出偏低


def test_validate_plan_good():
    c = validate_plan(
        side="long", entry=100.0, sl=95.0,
        tps=[TpTarget(price=110, reduce_pct=50), TpTarget(price=120, reduce_pct=50)],
        leverage=10.0, risk_pct=1.0, equity=10_000.0, available_margin=10_000.0,
        max_leverage=10.0, min_rr=2.0,
    )
    assert c.ok and not c.issues
    assert c.qty == 20.0 and c.margin == 200.0 and c.rr == 3.0
    assert c.liquidation_price == 90.5


def test_validate_plan_direction_and_leverage_issues():
    c = validate_plan(
        side="long", entry=100.0, sl=105.0,  # 止损方向错
        tps=[TpTarget(price=110, reduce_pct=100)],
        leverage=20.0, risk_pct=1.0, equity=10_000.0, available_margin=10_000.0,
        max_leverage=10.0, min_rr=2.0,
    )
    assert not c.ok
    assert any("止损" in i for i in c.issues)
    assert any("杠杆" in i for i in c.issues)


def test_validate_plan_low_rr_is_flag_not_issue():
    # 盈亏比 1.0 < 2.0：只记 flag、不拦（ok 仍 True）
    c = validate_plan(
        side="long", entry=100.0, sl=95.0,
        tps=[TpTarget(price=105, reduce_pct=100)],
        leverage=5.0, risk_pct=1.0, equity=10_000.0, available_margin=10_000.0,
        max_leverage=10.0, min_rr=2.0,
    )
    assert c.ok and not c.issues
    assert c.rr == 1.0 and any("盈亏比" in f for f in c.flags)


def test_validate_plan_margin_exceeds_available():
    c = validate_plan(
        side="long", entry=100.0, sl=99.0,  # 止损距离小 → 数量大 → 保证金大
        tps=[TpTarget(price=110, reduce_pct=100)],
        leverage=10.0, risk_pct=50.0, equity=10_000.0, available_margin=1_000.0,
        max_leverage=10.0, min_rr=2.0,
    )
    assert not c.ok and any("保证金" in i for i in c.issues)
