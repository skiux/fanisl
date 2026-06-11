"""交易引擎集成测试（用 fanisl_test 库 + 注入假价/假时钟，不联网、不调 Claude）。"""

from datetime import datetime, timedelta, timezone

import pytest

from analyzer.trading.engine import TradingEngine
from analyzer.trading.models import Adjustment, TpTarget, TradePlan


@pytest.fixture
def acct(trading_store):
    return trading_store.ensure_account(
        "test", initial_balance=10_000.0, max_leverage=10.0,
        margin_mode="isolated", default_risk_pct=1.0,
    )


def _engine(store, price_holder):
    clock = {"t": datetime(2026, 6, 8, tzinfo=timezone.utc)}

    def now_fn():
        clock["t"] += timedelta(seconds=60)
        return clock["t"]

    return TradingEngine(
        store, price_fn=lambda s: price_holder["v"],
        taker_fee_bps=5.0, slippage_bps=2.0, min_rr=2.0,
        reeval_band_pct=0.5, now_fn=now_fn,
    )


def _long_plan(**over) -> TradePlan:
    base = dict(
        symbol="BTC/USDT", side="long", strategy_type="trend", thesis="t",
        mtf={"higher_tf": "up", "trading_tf": "up", "entry_tf": "pullback", "aligned": True},
        macro_context="-", risk_events="无", regime="trend", risk_appetite="risk-on",
        entry_type="market", entry_price=100.0, entry_trigger="break",
        leverage=10.0, risk_pct=1.0, sl_price=95.0, sl_basis="结构",
        tp_targets=[TpTarget(price=110, reduce_pct=50), TpTarget(price=120, reduce_pct=50)],
    )
    base.update(over)
    return TradePlan.model_validate(base)


def test_wake_condition_triggers_reeval(trading_store, acct):
    # 计划声明"价≥108 唤醒我"；价格涨到 108 → 引擎记 needs_review
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    plan = _long_plan(wake_conditions=[{"type": "price_above", "value": 108.0}])
    tid = eng.open_trade(acct["id"], plan)["trade_id"]
    price["v"] = 106.0
    eng.tick(acct["id"])
    evs1 = [e for e in trading_store.events(tid) if e["kind"] == "needs_review"]
    price["v"] = 108.5
    eng.tick(acct["id"])
    evs2 = [e for e in trading_store.events(tid) if e["kind"] == "needs_review"]
    assert len(evs1) == 0 and len(evs2) == 1
    assert any("价≥108" in r for r in evs2[0]["payload"]["reasons"])


def test_open_market_trade(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    res = eng.open_trade(acct["id"], _long_plan())
    assert res["ok"] and not res["rejected"]
    assert res["qty"] == 20.0 and res["rr"] == 3.0

    tr = trading_store.get_trade(res["trade_id"])
    assert tr["status"] == "open" and tr["qty"] == 20.0
    # 余额扣了保证金(~200)+手续费 → 明显低于 1万
    acct2 = trading_store.get_account(acct["id"])
    assert 9700 < acct2["balance"] < 9800
    assert any(o["kind"] == "entry" and o["status"] == "filled" for o in trading_store.orders(tr["id"]))
    assert trading_store.position_snapshots(tr["id"])  # 开仓即有一帧


def test_take_profit_then_close_win(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]

    price["v"] = 111.0
    eng.tick(acct["id"])  # TP1 @110，减仓一半
    assert trading_store.get_trade(tid)["qty"] == pytest.approx(10.0)

    price["v"] = 121.0
    eng.tick(acct["id"])  # TP2 @120，平掉 → 收尾
    tr = trading_store.get_trade(tid)
    assert tr["status"] == "closed"
    res = trading_store.get_result(tid)
    assert res["outcome"] == "win" and res["pnl_abs"] > 0
    assert res["realized_r"] > 0 and res["exit_reason"] == "tp"
    # 盈利后余额应高于初始
    assert trading_store.get_account(acct["id"])["balance"] > 10_000


def test_stop_loss_loss(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]

    price["v"] = 94.0
    eng.tick(acct["id"])
    tr = trading_store.get_trade(tid)
    assert tr["status"] == "closed"
    res = trading_store.get_result(tid)
    assert res["exit_reason"] == "sl" and res["outcome"] == "loss" and res["pnl_abs"] < 0


def test_liquidation(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]

    price["v"] = 90.0  # 跳穿强平价(~90.5) → 强平先于止损
    eng.tick(acct["id"])
    res = trading_store.get_result(tid)
    assert res["exit_reason"] == "liquidation" and res["outcome"] == "loss"


def test_invalid_plan_recorded_not_executed(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    res = eng.open_trade(acct["id"], _long_plan(sl_price=105.0))  # 多单止损在进场之上 → 无效
    assert res["rejected"] and not res["ok"]
    tr = trading_store.get_trade(res["trade_id"])
    assert tr["status"] == "planned"  # 未执行
    assert trading_store.get_account(acct["id"])["balance"] == 10_000  # 没动钱
    kinds = {e["kind"] for e in trading_store.events(res["trade_id"])}
    assert "plan_rejected" in kinds


def test_partial_exit_uses_remaining_basis(trading_store, acct):
    # 连续两次「减 50%」应按当前剩余仓位算：20 → 10 → 5（而不是第二次清零）
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]
    assert trading_store.get_trade(tid)["qty"] == pytest.approx(20.0)

    eng.apply_adjustment(tid, Adjustment(action="partial_exit", reason="减半", thesis_still_valid=True, reduce_pct=50))
    assert trading_store.get_trade(tid)["qty"] == pytest.approx(10.0)
    eng.apply_adjustment(tid, Adjustment(action="partial_exit", reason="再减半", thesis_still_valid=True, reduce_pct=50))
    tr = trading_store.get_trade(tid)
    assert tr["qty"] == pytest.approx(5.0) and tr["status"] == "open"  # 没被清零


def test_limit_order_expires_after_ttl(trading_store, acct):
    # 限价单挂着、价格不触发、超过 TTL → 引擎撤单作废
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    eng.entry_ttl_hours = 0.0001  # ~0.36s；_engine 的时钟每拍 +60s，必然超时
    # 限价多单挂在现价(100)下方且止损更低，结构合法、但价格不回踩 → 不成交
    plan = _long_plan(entry_type="limit", entry_price=90.0, sl_price=85.0)
    tid = eng.open_trade(acct["id"], plan)["trade_id"]
    assert trading_store.get_trade(tid)["status"] == "planned"
    eng.tick(acct["id"])  # 推进一拍，时钟前进 → 超时撤单
    tr = trading_store.get_trade(tid)
    assert tr["status"] == "cancelled"
    kinds = {e["kind"] for e in trading_store.events(tid)}
    assert "entry_expired" in kinds


def test_adjustment_move_sl_versions_plan(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]

    out = eng.apply_adjustment(tid, Adjustment(action="move_sl", reason="保本", thesis_still_valid=True, new_sl_price=99.0))
    assert out["ok"] and out["version"] == 2
    active = trading_store.active_plan(tid)
    assert active["version"] == 2 and active["plan"]["sl_price"] == 99.0
    assert len(trading_store.plan_versions(tid)) == 2


def test_scorecard_aggregates(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    # 一笔盈利
    t1 = eng.open_trade(acct["id"], _long_plan())["trade_id"]
    price["v"] = 121.0
    eng.tick(acct["id"])
    # 一笔止损
    price["v"] = 100.0
    eng.open_trade(acct["id"], _long_plan())
    price["v"] = 94.0
    eng.tick(acct["id"])

    sc = trading_store.scorecard(acct["id"])
    assert sc["closed_trades"] == 2
    assert 0.0 <= sc["win_rate"] <= 1.0
    assert sc["max_drawdown"] >= 0
