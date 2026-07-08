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


def test_open_trade_rejected_at_max_positions(trading_store, acct):
    from analyzer.config import Settings
    price = {"v": 100.0}
    st = Settings(trading_max_positions=2, trading_max_same_direction=9, trading_max_total_risk_pct=90.0)
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}), settings=st)
    assert svc.open_trade(acct["id"], "BTC/USDT")["kind"] == "plan"
    assert svc.open_trade(acct["id"], "ETH/USDT")["kind"] == "plan"
    r = svc.open_trade(acct["id"], "SOL/USDT")  # 第 3 笔越过仓位上限
    assert r["kind"] == "rejected" and "最大持仓数" in r["reason"]


def test_open_trade_rejected_same_direction_cap(trading_store, acct):
    from analyzer.config import Settings
    price = {"v": 100.0}
    st = Settings(trading_max_positions=9, trading_max_same_direction=2, trading_max_total_risk_pct=90.0)
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}), settings=st)  # _plan 是 long
    svc.open_trade(acct["id"], "BTC/USDT")
    svc.open_trade(acct["id"], "ETH/USDT")
    r = svc.open_trade(acct["id"], "SOL/USDT")  # 第 3 笔同向 long → 拦
    assert r["kind"] == "rejected" and "同方向" in r["reason"]


def test_open_trade_rejected_over_risk_budget(trading_store, acct):
    from analyzer.config import Settings
    price = {"v": 100.0}
    # 每笔风险 1%（默认 risk_pct=1），总预算 1.5% → 第 2 笔就超
    st = Settings(trading_max_positions=9, trading_max_same_direction=9, trading_max_total_risk_pct=1.5)
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}), settings=st)
    assert svc.open_trade(acct["id"], "BTC/USDT")["kind"] == "plan"
    r = svc.open_trade(acct["id"], "ETH/USDT")
    assert r["kind"] == "rejected" and "在险预算" in r["reason"]


def test_force_trade_flag_flows_to_agent(trading_store, acct):
    agent = FakeAgent(entry={"kind": "plan", "plan": _plan()})
    svc = TradingService(trading_store, _engine(trading_store, {"v": 100.0}), agent)
    trading_store.set_force_trade(acct["id"], True)
    svc.open_trade(acct["id"], "BTC/USDT")
    assert agent.last_force is True  # 账户开关传到了 decide_entry


def test_verify_declines_judges_against_bias(trading_store, acct):
    from analyzer.config import Settings
    price = {"v": 110.0}  # 现价比拒绝时(100)涨了 10%
    st = Settings(trading_decline_move_threshold_pct=0.5)
    svc = TradingService(trading_store, _engine(trading_store, price), FakeAgent(), settings=st)
    # 拒绝时快照价 100，bias=long，立即可校验（recheck 0h）
    inputs = {"snapshot": {"timeframes": {"1h": {"last_price": 100.0}}}}
    trading_store.record_decline(acct["id"], "BTC/USDT", "结构不清",
                                 recheck_after_hours=0.0, bias_if_forced="long", inputs=inputs)
    out = svc.verify_declines(acct["id"])
    assert len(out) == 1
    # bias=long 且涨了 10% > 阈值 → 错过机会 → 拒绝判错
    assert out[0]["correct"] is False and out[0]["move_pct"] == pytest.approx(10.0, rel=0.01)
    # 已校验，不重复
    assert svc.verify_declines(acct["id"]) == []


def test_sync_shadows_mirrors_entry(trading_store, acct):
    from analyzer.config import AccountSpec, Settings
    price = {"v": 100.0}
    shadow = trading_store.ensure_account(
        "main_shadow", initial_balance=1_000.0, max_leverage=10.0,
        margin_mode="cross", default_risk_pct=1.0,
    )
    st = Settings(trading_max_positions=9, trading_max_same_direction=9, trading_max_total_risk_pct=90.0)
    svc = TradingService(trading_store, _engine(trading_store, price),
                         FakeAgent(entry={"kind": "plan", "plan": _plan()}), settings=st)
    src_tid = svc.open_trade(acct["id"], "BTC/USDT")["trade_id"]

    accounts = [
        {"id": acct["id"], "spec": AccountSpec(name="test"), "managed": True, "mirror_of": None},
        {"id": shadow["id"], "spec": AccountSpec(name="main_shadow", managed=False, mirror_of="test"),
         "managed": False, "mirror_of": "test"},
    ]
    out = svc.sync_shadows(accounts)
    assert len(out) == 1 and out[0]["source_trade_id"] == src_tid
    # 影子账户里多了一笔持仓
    assert len(trading_store.list_open_trades(shadow["id"])) == 1
    # 再同步一次不重复镜像
    assert svc.sync_shadows(accounts) == []


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


# --- 评测台重定位：setup 探测 → 闸门 → 开仓 / 否决力 / 按 setup 评分 ---------

from analyzer.trading import playbook
from analyzer.trading.models import EventAnnotation, SetupGateDecision
from analyzer.trading.playbook import BacktestPrior, SetupSignal, SetupSpec


class GateAgent(FakeAgent):
    """带闸门的假 Claude。"""
    def __init__(self, decision: SetupGateDecision, **kw):
        super().__init__(**kw)
        self._gate = decision
        self.gate_calls = 0

    def gate_setup(self, setup, signal, plan_summary):
        self.gate_calls += 1
        self.last_gate = {"setup": setup, "signal": signal, "plan_summary": plan_summary}
        return {"decision": self._gate, "inputs": {"setup": setup}, "transcript": []}


def _setup_spec(**over) -> SetupSpec:
    base = dict(
        key="fake_setup", name="测试 setup", hypothesis_ref="H0", status="candidate",
        symbols=["BTC/USDT"], risk_pct=0.5, leverage=2.0,
        holding_hours=168.0, cooldown_hours=168.0,
        prior=BacktestPrior(n=100, hit_rate=0.55, avg_net_return=0.01, ci_low=0.002,
                            holding_hours=168.0, source="doc/x.md", regime_notes="-"),
    )
    base.update(over)
    return SetupSpec.model_validate(base)


@pytest.fixture
def fake_setup():
    spec = _setup_spec()
    playbook.register(
        spec, lambda pool, sym, now: SetupSignal(
            side="long", ref_price=100.0, atr_daily=2.0, features={"ret_lookback": 0.1}),
    )
    yield spec
    playbook.unregister(spec.key)


def _svc(trading_store, price, agent, pool, **settings_over):
    from analyzer.config import Settings
    kw = dict(trading_max_positions=9, trading_max_same_direction=9,
              trading_max_total_risk_pct=90.0)
    kw.update(settings_over)
    return TradingService(trading_store, _engine(trading_store, price), agent,
                          settings=Settings(**kw), market_pool=pool)


def test_detect_confirm_opens_setup_trade(trading_store, acct, pool, fake_setup):
    gate = GateAgent(SetupGateDecision(verdict="confirm", reasoning="干净实例"))
    svc = _svc(trading_store, {"v": 100.0}, gate, pool)
    out = svc.detect_setups(acct["id"], specs=[fake_setup])
    assert len(out) == 1 and out[0]["verdict"] == "confirmed" and out[0]["opened"]
    # 闸门拿到了先验与模板摘要（信念来自回测，不是 Claude 自己的判断）
    assert gate.last_gate["setup"]["prior"]["avg_net_return"] == 0.01
    assert gate.last_gate["plan_summary"]["time_exit_hours"] == 168.0
    # 交易带 setup_key，信号记录 confirmed 且关联 trade_id
    tid = out[0]["trade_id"]
    assert trading_store.get_trade(tid)["setup_key"] == "fake_setup"
    sig = trading_store.list_setup_signals(acct["id"])[0]
    assert sig["verdict"] == "confirmed" and sig["trade_id"] == tid


def test_detect_veto_records_no_trade_and_annotations(trading_store, acct, pool, fake_setup):
    gate = GateAgent(SetupGateDecision(
        verdict="veto", veto_category="imminent_event", reasoning="2h 后 CPI",
        event_annotations=[EventAnnotation(kind="macro", severity="high", note="CPI 临近")],
    ))
    svc = _svc(trading_store, {"v": 100.0}, gate, pool)
    out = svc.detect_setups(acct["id"], specs=[fake_setup])
    assert out[0]["verdict"] == "vetoed" and out[0]["veto_category"] == "imminent_event"
    assert trading_store.list_open_trades(acct["id"]) == []
    sig = trading_store.list_setup_signals(acct["id"])[0]
    # veto 假想跟踪字段已备好（到期校验否决力）
    assert sig["hypo_entry_price"] == 100.0 and sig["hypo_horizon_hours"] == 168.0
    # 事件标注落库（"文档即数据"通道）
    anns = trading_store.list_event_annotations()
    assert len(anns) == 1 and anns[0]["kind"] == "macro" and anns[0]["source"] == "gate:fake_setup"


def test_detect_dedups_on_cooldown_and_open_trade(trading_store, acct, pool, fake_setup):
    gate = GateAgent(SetupGateDecision(verdict="confirm", reasoning="ok"))
    svc = _svc(trading_store, {"v": 100.0}, gate, pool)
    assert len(svc.detect_setups(acct["id"], specs=[fake_setup])) == 1
    # 再探测：已有活跃 setup 仓位（且在冷却窗内）→ 不再触发、不再叫闸门
    assert svc.detect_setups(acct["id"], specs=[fake_setup]) == []
    assert gate.gate_calls == 1
    assert len(trading_store.list_setup_signals(acct["id"])) == 1


def test_detect_capacity_full_marks_skipped(trading_store, acct, pool, fake_setup):
    gate = GateAgent(SetupGateDecision(verdict="confirm", reasoning="ok"))
    svc = _svc(trading_store, {"v": 100.0}, gate, pool, trading_max_positions=0)
    out = svc.detect_setups(acct["id"], specs=[fake_setup])
    assert out[0]["verdict"] == "skipped"
    sig = trading_store.list_setup_signals(acct["id"])[0]
    assert sig["verdict"] == "skipped" and "最大持仓数" in sig["reasoning"]
    assert trading_store.list_open_trades(acct["id"]) == []


def test_verify_vetoes_scores_avoided_loss(trading_store, acct, pool, fake_setup):
    # 两条到期 veto：价格跌到 90 → long 假想亏（否决对）；short 假想赚（否决错）
    price = {"v": 90.0}
    svc = _svc(trading_store, price, GateAgent(SetupGateDecision(verdict="confirm", reasoning="x")), pool)
    for side in ("long", "short"):
        sid = trading_store.record_setup_signal(
            acct["id"], setup_key="fake_setup", symbol="BTC/USDT", side=side,
            features={}, prior={}, hypo_entry_price=100.0, hypo_horizon_hours=0.0,
        )
        trading_store.set_signal_verdict(sid, "vetoed", veto_category="other", reasoning="-")
    out = svc.verify_vetoes(acct["id"])
    assert len(out) == 2
    rets = sorted(o["hypo_net_return"] for o in out)
    assert rets[0] < 0 < rets[1]  # long 亏、short 赚
    avoided = [o["avoided_loss"] for o in sorted(out, key=lambda o: o["signal_id"])]
    assert avoided == [True, False]
    # 已校验不重复
    assert svc.verify_vetoes(acct["id"]) == []


def test_scorecard_by_setup_groups_and_funnels(trading_store, acct, pool, fake_setup):
    gate = GateAgent(SetupGateDecision(verdict="confirm", reasoning="ok"),
                     entry={"kind": "plan", "plan": _plan()})
    price = {"v": 100.0}
    svc = _svc(trading_store, price, gate, pool)
    # 一笔 setup 交易（止损平掉）+ 一笔酌情交易（也止损）
    svc.detect_setups(acct["id"], specs=[fake_setup])
    svc.open_trade(acct["id"], "ETH/USDT")
    price["v"] = 80.0
    svc.engine.tick(acct["id"])

    rows = {r["setup_key"]: r for r in trading_store.scorecard_by_setup(acct["id"])}
    assert set(rows) == {"fake_setup", "discretionary"}
    fs = rows["fake_setup"]
    assert fs["closed_trades"] == 1 and fs["signals"]["confirmed"] == 1
    # 与回测先验同单位的 live 净收益（对照 Phase 4 的 live-vs-backtest 门）
    assert fs["avg_net_return"] is not None and fs["avg_net_return"] < 0
    assert fs["avg_bh_r"] is not None
    assert rows["discretionary"]["closed_trades"] == 1
