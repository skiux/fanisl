"""交易服务编排测试：注入假 Claude（不联网），验证 plan/decline/管理/复盘四条路径。"""

from datetime import datetime, timedelta, timezone

import pytest

from analyzer.trading.engine import TradingEngine
from analyzer.trading.models import Adjustment, DeclineDecision, Review, TpTarget, TradePlan
from analyzer.trading.service import TradingService


@pytest.fixture
def acct(trading_store):
    return trading_store.ensure_account(
        "test", initial_balance=10_000.0, max_leverage=10.0,
        margin_mode="isolated", default_risk_pct=1.0,
    )


def _engine(store, price):
    clock = {"t": datetime(2026, 6, 8, tzinfo=timezone.utc)}

    def now_fn():
        clock["t"] += timedelta(seconds=60)
        return clock["t"]

    return TradingEngine(store, price_fn=lambda s: price["v"], now_fn=now_fn)


def _plan() -> TradePlan:
    return TradePlan.model_validate(dict(
        symbol="BTC/USDT", side="long", strategy_type="trend", thesis="t",
        mtf={"higher_tf": "u", "trading_tf": "u", "entry_tf": "p", "aligned": True},
        macro_context="-", risk_events="无", regime="trend", risk_appetite="on",
        entry_type="market", entry_price=100.0, entry_trigger="break",
        leverage=10.0, risk_pct=1.0, sl_price=95.0, sl_basis="结构",
        tp_targets=[TpTarget(price=120, reduce_pct=100)],
    ))


class FakeAgent:
    """按预设返回的假 Claude，签名与 TradeAgent 对齐。"""
    def __init__(self, *, entry=None, adjustment=None, review=None, scan=None):
        self._entry = entry
        self._adjustment = adjustment
        self._review = review
        self._scan = scan or []

    def decide_entry(self, symbol, summary, *, force=False):
        self.last_force = force
        return {**self._entry, "inputs": {"ctx": 1}, "transcript": [{"role": "assistant", "content": "x"}]}

    def scan(self, symbols, max_candidates):
        from analyzer.trading.models import ScanCandidate, ScanResult
        self.last_universe = symbols
        cands = [ScanCandidate(symbol=s, reason="x") for s in self._scan[:max_candidates]]
        return {"result": ScanResult(candidates=cands), "digests": {}, "transcript": [], "skipped": []}

    def decide_management(self, trade, plan, position):
        return {"adjustment": self._adjustment, "inputs": {}, "transcript": []}

    def review_trade(self, timeline):
        return {"review": self._review, "transcript": []}


def test_open_trade_plan_path(trading_store, acct):
    price = {"v": 100.0}
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}))
    res = svc.open_trade(acct["id"], "BTC/USDT")
    assert res["kind"] == "plan" and res["ok"]
    assert trading_store.get_trade(res["trade_id"])["status"] == "open"
    # 决策输入被冻结落库
    tl = trading_store.timeline(res["trade_id"])
    assert tl["plans"][0]["plan"]["thesis"] == "t"


def test_open_trade_decline_path(trading_store, acct):
    price = {"v": 100.0}
    decline = DeclineDecision(symbol="BTC/USDT", reason="结构不清", watch_for="站上日线")
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "decline", "decline": decline}))
    res = svc.open_trade(acct["id"], "BTC/USDT")
    assert res["kind"] == "decline"
    declines = trading_store.list_declines(acct["id"])
    assert len(declines) == 1 and declines[0]["reason"] == "结构不清"


def test_review_closed_path(trading_store, acct):
    price = {"v": 100.0}
    review = Review(plan_adherence="守纪律", entry_timing="尚可", exit_timing="止损执行到位",
                    skill_vs_luck="right_judgment_loss", skill_vs_luck_note="逻辑对、遇回撤",
                    lessons="进场可更耐心")
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}, review=review))
    tid = svc.open_trade(acct["id"], "BTC/USDT")["trade_id"]
    price["v"] = 94.0
    svc.engine.tick(acct["id"])  # 止损平仓
    assert trading_store.get_trade(tid)["status"] == "closed"

    done = svc.review_closed(acct["id"])
    assert done == [tid]
    assert trading_store.get_review(tid)["review"]["skill_vs_luck"] == "right_judgment_loss"


def test_mark_skips_when_flat_and_ticks_when_open(trading_store, acct):
    price = {"v": 100.0}
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}))
    assert svc.mark(acct["id"]) == []  # 无活跃交易 → 跳过
    tid = svc.open_trade(acct["id"], "BTC/USDT")["trade_id"]
    price["v"] = 94.0
    svc.mark(acct["id"])  # 有持仓 → 盯市触发止损
    assert trading_store.get_trade(tid)["status"] == "closed"


def test_scan_opens_candidate_and_respects_cap(trading_store, acct):
    from analyzer.config import Settings
    price = {"v": 100.0}
    agent = FakeAgent(entry={"kind": "plan", "plan": _plan()}, scan=["ETH/USDT", "SOL/USDT"])
    st = Settings(trading_max_positions=1, trading_max_total_risk_pct=50.0)
    svc = TradingService(trading_store, _engine(trading_store, price), agent, settings=st)
    r = svc.scan(acct["id"])
    # 上限=1，只应开 1 笔（即便 triage 给了 2 个候选）
    opened = [o for o in r["opened"] if o.get("trade_id")]
    assert len(opened) == 1 and opened[0]["symbol"] == "ETH/USDT"
    # 再扫一次：已达上限 → 不再开
    r2 = svc.scan(acct["id"])
    assert r2["scanned"] == 0 and "上限" in r2.get("note", "")


def test_force_trade_flag_flows_to_agent(trading_store, acct):
    agent = FakeAgent(entry={"kind": "plan", "plan": _plan()})
    svc = TradingService(trading_store, _engine(trading_store, {"v": 100.0}), agent)
    trading_store.set_force_trade(acct["id"], True)
    svc.open_trade(acct["id"], "BTC/USDT")
    assert agent.last_force is True  # 账户开关传到了 decide_entry


def test_manage_pending_applies_adjustment(trading_store, acct):
    price = {"v": 100.0}
    adj = Adjustment(action="move_sl", reason="保本", thesis_still_valid=True, new_sl_price=99.0)
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}, adjustment=adj))
    tid = svc.open_trade(acct["id"], "BTC/USDT")["trade_id"]
    # 制造一条待重评
    trading_store.add_event(tid, "needs_review", "engine", {"reasons": ["逼近止损"]})
    assert trading_store.reeval_pending(tid)

    acted = svc.manage_pending(acct["id"])
    assert acted and acted[0]["action"] == "move_sl"
    assert trading_store.active_plan(tid)["plan"]["sl_price"] == 99.0
    assert not trading_store.reeval_pending(tid)  # 已处理
