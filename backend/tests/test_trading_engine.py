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


def test_wake_condition_is_one_shot(trading_store, acct):
    # 同一唤醒条件命中过一次后不再重复触发（一次性，治理复评风暴）
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    eng.reeval_cooldown_min = 0.0  # 关掉冷却，单独验证一次性
    plan = _long_plan(wake_conditions=[{"type": "price_above", "value": 108.0}])
    tid = eng.open_trade(acct["id"], plan)["trade_id"]
    price["v"] = 108.5
    eng.tick(acct["id"])
    # 模拟已被处理（adjust），否则 _has_open_reeval 会挡住后续
    trading_store.add_event(tid, "adjust_hold", "claude", {"reason": "x"})
    price["v"] = 109.0
    eng.tick(acct["id"])  # 条件仍满足，但已触发过 → 不再触发
    needs = [e for e in trading_store.events(tid) if e["kind"] == "needs_review"]
    assert len(needs) == 1


def test_reeval_cooldown_suppresses_storm(trading_store, acct):
    # "逼近止损" 是电平条件：冷却窗内不应每拍重复触发
    price = {"v": 100.0}
    eng = _engine(trading_store, price)  # 时钟每拍 +60s，冷却默认 30min
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]  # sl=95
    price["v"] = 95.3  # 进入逼近止损带
    eng.tick(acct["id"])
    trading_store.add_event(tid, "adjust_hold", "claude", {"reason": "再看"})
    # 连推几拍，仍在带内，但冷却 + 宽限应抑制重复触发
    for _ in range(5):
        eng.tick(acct["id"])
    needs = [e for e in trading_store.events(tid) if e["kind"] == "needs_review"]
    assert len(needs) == 1


def test_post_adjust_grace_blocks_immediate_reeval(trading_store, acct):
    # 刚 adjust 完，宽限窗内不立刻再触发重评
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    eng.reeval_cooldown_min = 0.0
    eng.reeval_grace_min = 30.0
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]
    price["v"] = 95.3
    eng.tick(acct["id"])
    trading_store.add_event(tid, "adjust_move_sl", "claude", {"reason": "保本"})
    eng.tick(acct["id"])  # 紧接着的一拍处在宽限窗内
    needs = [e for e in trading_store.events(tid) if e["kind"] == "needs_review"]
    assert len(needs) == 1  # 没有因宽限被立刻再叫


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
    # 反事实必须看到价格碰到了 SL（出场价补进价序列）→ 基准≈-1R、管理贡献≈0（引擎止损非管理）
    assert res["counterfactual_r"] == -1.0
    assert abs(res["mgmt_contribution_r"]) < 0.1


def test_liquidation(trading_store, acct):
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan())["trade_id"]

    price["v"] = 90.0  # 跳穿强平价(~90.5) → 强平先于止损
    eng.tick(acct["id"])
    res = trading_store.get_result(tid)
    assert res["exit_reason"] == "liquidation" and res["outcome"] == "loss"


@pytest.fixture
def cross_acct(trading_store):
    return trading_store.ensure_account(
        "cross", initial_balance=1_000.0, max_leverage=10.0,
        margin_mode="cross", default_risk_pct=1.0,
    )


def test_cross_position_has_no_isolated_liq_and_survives_deeper(trading_store, cross_acct):
    # 全仓：单仓没有 isolated 强平价，浮亏由整个账户缓冲，不在逐仓 liq 价被打掉
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    plan = _long_plan(sl_price=80.0, leverage=10.0,
                      tp_targets=[TpTarget(price=130, reduce_pct=100)])
    tid = eng.open_trade(cross_acct["id"], plan)["trade_id"]
    assert trading_store.get_trade(tid)["liquidation_price"] is None
    price["v"] = 91.0  # 逐仓 10x 早该爆(~90.5)，但全仓账户权益仍充足 → 不强平
    eng.tick(cross_acct["id"])
    assert trading_store.get_trade(tid)["status"] == "open"


def test_cross_account_level_liquidation(trading_store, cross_acct):
    # 全仓：止损放得极远、仓位占满保证金 → 价格大跌吃穿账户权益 → 账户级强平
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    # sl=10 形同无止损、满仓（margin≈本金），用大 risk_pct 把仓位顶到保证金上限
    plan = _long_plan(risk_pct=850.0, leverage=10.0, sl_price=10.0,
                      tp_targets=[TpTarget(price=200, reduce_pct=100)])
    tid = eng.open_trade(cross_acct["id"], plan)["trade_id"]
    assert trading_store.get_trade(tid)["status"] == "open"
    price["v"] = 80.0  # 远未触及 sl=10，但浮亏吃穿账户 → 账户级强平
    eng.tick(cross_acct["id"])
    res = trading_store.get_result(tid)
    assert res is not None and res["exit_reason"] == "liquidation"


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


def test_invalidation_price_closes_deterministically(trading_store, acct):
    # 失效价在止损内侧：价格跌到失效价（但未到止损）→ 引擎直接平仓，无需 Claude 重评
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    plan = _long_plan(sl_price=95.0, invalidation_price=97.0)
    tid = eng.open_trade(acct["id"], plan)["trade_id"]
    price["v"] = 96.5  # < 97 失效，但 > 95 止损
    eng.tick(acct["id"])
    tr = trading_store.get_trade(tid)
    assert tr["status"] == "closed"
    res = trading_store.get_result(tid)
    assert res["exit_reason"] == "thesis_invalidated"


def test_invalidation_wrong_side_ignored(trading_store, acct):
    # 多单失效价填在进场之上（方向错）→ 忽略 + flag，不应在开仓瞬间触发
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    plan = _long_plan(invalidation_price=105.0)
    res = eng.open_trade(acct["id"], plan)
    tid = res["trade_id"]
    assert trading_store.get_trade(tid)["status"] == "open"  # 没被秒平
    plan_doc = trading_store.active_plan(tid)["plan"]
    assert plan_doc["invalidation_price"] is None
    assert any("失效价" in f for f in plan_doc["computed"]["flags"])


def test_event_risk_haircut_reduces_position(trading_store, acct):
    # 同一计划，risk_factor=0.5 → 仓位减半、风险额减半
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    full = eng.open_trade(acct["id"], _long_plan())
    price["v"] = 100.0
    # 第二笔的权益已被第一笔占用而略变，故用相对容差（重点是减半）
    half = eng.open_trade(acct["id"], _long_plan(), risk_factor=0.5, risk_note="CPI 还有 3h")
    assert half["qty"] == pytest.approx(full["qty"] / 2, rel=0.01)
    plan_doc = trading_store.active_plan(half["trade_id"])["plan"]
    assert plan_doc["computed"]["effective_risk_pct"] == pytest.approx(0.5)
    assert any("事件邻近" in f for f in plan_doc["computed"]["flags"])


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


# --- 评测台重定位：setup 关联 / 时间出场 / 配对 buy&hold 基准 ----------------

def _short_plan(**over):
    base = dict(
        symbol="BTC/USDT", side="short", strategy_type="trend", thesis="t",
        entry_type="market", entry_price=100.0, entry_trigger="setup",
        leverage=2.0, risk_pct=1.0, sl_price=105.0, sl_basis="模板",
        tp_targets=[TpTarget(price=90, reduce_pct=100)],
    )
    base.update(over)
    return TradePlan.model_validate(base)


def test_setup_key_persisted_on_trade(trading_store, acct):
    eng = _engine(trading_store, {"v": 100.0})
    tid = eng.open_trade(acct["id"], _long_plan(setup_key="tsmom_7d"))["trade_id"]
    assert trading_store.get_trade(tid)["setup_key"] == "tsmom_7d"
    # 酌情交易（无 setup_key）为 NULL
    tid2 = eng.open_trade(acct["id"], _long_plan(symbol="ETH/USDT"))["trade_id"]
    assert trading_store.get_trade(tid2)["setup_key"] is None


def test_time_exit_closes_at_horizon(trading_store, acct):
    # 可控时钟：开仓后拨到持有期之后，tick 应按 time_stop 确定性平仓
    clock = {"t": datetime(2026, 6, 8, tzinfo=timezone.utc)}
    price = {"v": 100.0}
    eng = TradingEngine(trading_store, price_fn=lambda s: price["v"],
                        now_fn=lambda: clock["t"])
    tid = eng.open_trade(acct["id"], _long_plan(time_exit_hours=168.0))["trade_id"]

    clock["t"] += timedelta(hours=167)
    eng.tick(acct["id"])
    assert trading_store.get_trade(tid)["status"] == "open"  # 未到期不动

    clock["t"] += timedelta(hours=2)
    acts = eng.tick(acct["id"])
    assert any(a["action"] == "time_exit" for a in acts)
    assert trading_store.get_trade(tid)["status"] == "closed"
    res = trading_store.get_result(tid)
    assert res["exit_reason"] == "time_stop"
    # 到时平仓的成交要计入 PnL（kind 映射为 exit，不能漏结算）
    assert res["pnl_abs"] != 0 or res["outcome"] == "breakeven"


def test_bh_r_pairs_against_buy_and_hold(trading_store, acct):
    # 空单在下跌中止盈：实际 R 为正，同窗口 buy&hold（永远做多）基准应为负
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _short_plan())["trade_id"]
    price["v"] = 89.0
    eng.tick(acct["id"])  # TP 90 触发全平
    res = trading_store.get_result(tid)
    assert res["realized_r"] is not None and res["realized_r"] > 0
    assert res["bh_r"] is not None and res["bh_r"] < 0
    # 量级对齐：空单赚的 ≈ 多头拿着亏的（同窗口同名义，差手续费/滑点）
    assert res["bh_r"] == pytest.approx(-res["realized_r"], abs=0.2)


def test_bh_r_matches_long_hold(trading_store, acct):
    # 多单一路持有到止盈：bh_r 应与 realized_r 同号且接近
    price = {"v": 100.0}
    eng = _engine(trading_store, price)
    tid = eng.open_trade(acct["id"], _long_plan(tp_targets=[TpTarget(price=110, reduce_pct=100)]))["trade_id"]
    price["v"] = 111.0
    eng.tick(acct["id"])
    res = trading_store.get_result(tid)
    assert res["bh_r"] is not None and res["bh_r"] > 0
    assert res["bh_r"] == pytest.approx(res["realized_r"], abs=0.2)
