"""撮合与会计引擎（确定性）：进场/加减仓/止损止盈/强平/盯市/触发重评。

真相在这里——Claude 只给点位与依据，成交、盈亏、强平、结果全由引擎按真实价算。
价格通过 price_fn 注入（生产用 resolver.fetch_ticker，测试传假价），便于单测。
会计模型：balance=可用现金；开仓扣(保证金+手续费)、平仓还保证金并结算盈亏-手续费。
权益 = balance + 占用保证金 + 浮动盈亏。
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Callable

from . import calc
from .models import Adjustment, TradePlan
from .store import TradingStore

PriceFn = Callable[[str], float]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TradingEngine:
    def __init__(
        self, store: TradingStore, *, price_fn: PriceFn,
        taker_fee_bps: float = 5.0, slippage_bps: float = 2.0,
        min_rr: float = 2.0, reeval_band_pct: float = 0.5,
        time_stop_hours: float = 0.0, entry_ttl_hours: float = 8.0,
        reeval_cooldown_min: float = 30.0, reeval_grace_min: float = 15.0,
        now_fn: Callable[[], datetime] = _now,
    ) -> None:
        self.store = store
        self.price_fn = price_fn
        self.taker_fee_bps = taker_fee_bps
        self.slippage_bps = slippage_bps
        self.min_rr = min_rr
        self.reeval_band_pct = reeval_band_pct
        self.time_stop_hours = time_stop_hours
        self.entry_ttl_hours = entry_ttl_hours
        self.reeval_cooldown_min = reeval_cooldown_min
        self.reeval_grace_min = reeval_grace_min
        self.now_fn = now_fn

    # --- 进场 -------------------------------------------------------------

    def open_trade(
        self, account_id: int, plan: TradePlan, *,
        inputs: dict | None = None, prompt: str | None = None, response=None,
    ) -> dict:
        """按计划开仓。校验不过 → 记为无效计划(planned)、不执行；过 → 市价/挂单进场。"""
        acct = self.store.get_account(account_id)
        if acct is None:
            return {"ok": False, "error": "账户不存在"}

        check = calc.validate_plan(
            side=plan.side, entry=plan.entry_price, sl=plan.sl_price, tps=plan.tp_targets,
            leverage=plan.leverage, risk_pct=plan.risk_pct,
            equity=self._equity(account_id), available_margin=acct["balance"],
            max_leverage=acct["max_leverage"], min_rr=self.min_rr,
        )
        risk_amount = self._equity(account_id) * (plan.risk_pct / 100.0)
        plan_doc = {
            **plan.model_dump(),
            "computed": {
                "qty": check.qty, "notional": check.notional, "margin": check.margin,
                "rr": check.rr, "liquidation_price": check.liquidation_price,
                "risk_amount": risk_amount, "flags": check.flags,
            },
        }

        trade_id = self.store.create_trade(
            account_id, plan.symbol, plan.side, plan.strategy_type, plan.leverage
        )
        self.store.add_plan(trade_id, plan_doc, version=1, make_active=True)
        self.store.save_decision_inputs(
            trade_id, "entry", plan_version=1, inputs=inputs, prompt=prompt, response=response
        )

        if not check.ok:
            self.store.add_event(trade_id, "plan_rejected", "engine", {"issues": check.issues})
            return {"ok": False, "trade_id": trade_id, "issues": check.issues, "rejected": True}

        if check.flags:
            self.store.add_event(trade_id, "plan_flagged", "engine", {"flags": check.flags})

        if plan.entry_type == "market":
            self._fill_entry(account_id, trade_id, plan, check, self.price_fn(plan.symbol), slip=True)
        else:  # limit：挂单，等 tick 撮合
            self.store.add_order(
                trade_id, kind="entry", price=plan.entry_price, qty=check.qty, fee=0.0,
                actor="engine", status="pending", reason="限价挂单等待成交",
                placed_at=self.now_fn(),
            )
            self.store.add_event(trade_id, "entry_pending", "engine",
                                 {"price": plan.entry_price, "qty": check.qty})
        return {"ok": True, "trade_id": trade_id, "rejected": False,
                "qty": check.qty, "rr": check.rr, "flags": check.flags}

    def _fill_entry(self, account_id, trade_id, plan: TradePlan, check, ref_price: float, *, slip: bool) -> None:
        fill = calc.apply_slippage(ref_price, plan.side, self.slippage_bps, is_entry=True) if slip else ref_price
        notional = calc.notional(check.qty, fill)
        entry_fee = calc.fee(notional, self.taker_fee_bps)
        margin = calc.margin_required(check.qty, fill, plan.leverage)
        liq = calc.liquidation_price(fill, plan.leverage, plan.side)
        now = self.now_fn()

        self.store.adjust_balance(account_id, -(margin + entry_fee))
        self.store.open_position(trade_id, avg_entry=fill, qty=check.qty, margin=margin, liq=liq, opened_at=now)
        self.store.add_order(trade_id, kind="entry", price=fill, qty=check.qty, fee=entry_fee,
                             actor="engine", status="filled", reason="进场成交", filled_at=now)
        self.store.add_event(trade_id, "opened", "engine",
                             {"price": fill, "qty": check.qty, "margin": margin, "liq": liq})
        self._snapshot(trade_id, fill, now)

    # --- 盯市与撮合（每 tick）--------------------------------------------

    def tick(self, account_id: int | None = None) -> list[dict]:
        """推进所有未平仓交易一拍：撮合限价进场、盯市、止损止盈强平、触发重评。返回发生的动作。"""
        actions: list[dict] = []
        for tr in self.store.list_open_trades(account_id):
            actions.extend(self._tick_one(tr))
        # 撮合待成交的限价进场
        for tr in self._planned_with_pending(account_id):
            actions.extend(self._try_fill_limit(tr))
        return actions

    def _planned_with_pending(self, account_id) -> list[dict]:
        trades = self.store.list_trades(account_id) if account_id else []
        # account_id 必填场景下用；为通用起见，按 open 列表外再扫 planned
        out = []
        pool_trades = trades or []
        if not account_id:
            return out  # tick(None) 只盯已开仓，限价撮合需指定账户
        for tr in pool_trades:
            if tr["status"] == "planned":
                pend = [o for o in self.store.orders(tr["id"]) if o["kind"] == "entry" and o["status"] == "pending"]
                if pend:
                    out.append(tr)
        return out

    def _try_fill_limit(self, tr: dict) -> list[dict]:
        plan = self.store.active_plan(tr["id"])["plan"]
        now = self.now_fn()
        pend = next((o for o in self.store.orders(tr["id"])
                     if o["kind"] == "entry" and o["status"] == "pending"), None)
        # 限价单超时未成交 → 撤单作废（过时论点不应隔夜/隔周成交）
        ttl_h = plan.get("entry_ttl_hours") or self.entry_ttl_hours
        if pend and pend["placed_at"] and (now - pend["placed_at"]).total_seconds() >= ttl_h * 3600:
            self.store.cancel_pending_entry(tr["id"], reason="限价单超时未成交")
            self.store.add_event(tr["id"], "entry_expired", "engine",
                                 {"ttl_hours": ttl_h, "entry_price": plan["entry_price"]})
            return [{"trade_id": tr["id"], "action": "entry_expired"}]
        price = self.price_fn(tr["symbol"])
        entry = plan["entry_price"]
        side = tr["side"]
        crossed = price <= entry if side == "long" else price >= entry
        if not crossed:
            return []
        check = SimpleNamespace(**plan["computed"])  # 复用已算好的 qty
        self.store.void_pending_entry(tr["id"])  # 原挂单作废，按限价精确成交（不吃滑点）
        tp = TradePlan.model_validate(plan)
        self._fill_entry(tr["account_id"], tr["id"], tp, check, entry, slip=False)
        return [{"trade_id": tr["id"], "action": "limit_filled", "price": entry}]

    def _tick_one(self, tr: dict) -> list[dict]:
        tid = tr["id"]
        plan = self.store.active_plan(tid)["plan"]
        side = tr["side"]
        mark = self.price_fn(tr["symbol"])
        now = self.now_fn()
        sl = plan["sl_price"]
        liq = tr["liquidation_price"]
        acts: list[dict] = []

        # 1) 强平
        if (side == "long" and mark <= liq) or (side == "short" and mark >= liq):
            self._close(tr, liq, "liquidation", "engine", now)
            return [{"trade_id": tid, "action": "liquidation", "price": liq}]
        # 2) 止损
        if (side == "long" and mark <= sl) or (side == "short" and mark >= sl):
            fill = calc.apply_slippage(sl, side, self.slippage_bps, is_entry=False)
            self._close(tr, fill, "sl", "engine", now)
            return [{"trade_id": tid, "action": "stop_loss", "price": fill}]
        # 3) 止盈（逐目标，按原始数量比例减仓）
        acts += self._check_take_profit(tr, plan, mark, now)
        tr = self.store.get_trade(tid)  # 减仓后刷新
        if tr["status"] != "open":
            return acts

        # 盯市快照 + 触发重评
        self._snapshot(tid, mark, now)
        self._maybe_flag_reeval(tr, plan, mark, now)
        return acts

    def _check_take_profit(self, tr: dict, plan: dict, mark: float, now) -> list[dict]:
        tid, side = tr["id"], tr["side"]
        orig_qty = plan["computed"]["qty"]
        done = {round(o["price"], 8) for o in self.store.orders(tid) if o["kind"] == "tp"}
        acts: list[dict] = []
        for t in plan["tp_targets"]:
            price, reduce_pct = t["price"], t["reduce_pct"]
            if round(price, 8) in done:
                continue
            hit = mark >= price if side == "long" else mark <= price
            if not hit:
                continue
            cur = self.store.get_trade(tid)
            qty = min(orig_qty * reduce_pct / 100.0, cur["qty"])
            if qty <= 0:
                continue
            self._reduce(cur, price, qty, "tp", "engine", now)
            acts.append({"trade_id": tid, "action": "take_profit", "price": price, "qty": qty})
            if self.store.get_trade(tid)["qty"] <= 1e-12:
                self._finalize_close(tid, "tp", now)
                break
        return acts

    # --- 持仓调整（Claude 重评的结果）-----------------------------------

    def apply_adjustment(self, trade_id: int, adj: Adjustment, *, response=None) -> dict:
        """把 Claude 的调整落地：移止损/部分止盈/加仓/平仓/持有，并生成新计划版本。"""
        tr = self.store.get_trade(trade_id)
        if tr is None or tr["status"] != "open":
            return {"ok": False, "error": "交易不在持仓中"}
        now = self.now_fn()
        plan = self.store.active_plan(trade_id)["plan"]
        new_plan = dict(plan)

        if adj.action == "close" or not adj.thesis_still_valid:
            self._close(tr, self.price_fn(tr["symbol"]), "thesis_invalidated" if not adj.thesis_still_valid else "manual",
                        "claude", now)
        elif adj.action == "move_sl" and adj.new_sl_price is not None:
            new_plan["sl_price"] = adj.new_sl_price
        elif adj.action == "partial_exit" and adj.reduce_pct:
            # 按**当前剩余仓位**算（不是原始仓位）——"减剩余的 50%" 不应在已减半后变成清仓
            qty = min(tr["qty"] * adj.reduce_pct / 100.0, tr["qty"])
            if qty > 0:
                self._reduce(tr, self.price_fn(tr["symbol"]), qty, "reduce", "claude", now)
        elif adj.action == "add" and adj.add_qty_pct:
            self._add(tr, plan, adj.add_qty_pct, now)

        if adj.wake_conditions is not None:  # 重设唤醒条件
            new_plan["wake_conditions"] = [w.model_dump() for w in adj.wake_conditions]

        ver = self.store.next_plan_version(trade_id)
        new_plan["adjustment"] = adj.model_dump()
        self.store.add_plan(trade_id, new_plan, version=ver, make_active=True)
        self.store.save_decision_inputs(trade_id, "reeval", plan_version=ver, response=response)
        self.store.add_event(trade_id, f"adjust_{adj.action}", "claude",
                             {"reason": adj.reason, "version": ver})
        return {"ok": True, "version": ver, "action": adj.action}

    def _add(self, tr: dict, plan: dict, add_qty_pct: float, now) -> None:
        side = tr["side"]
        price = calc.apply_slippage(self.price_fn(tr["symbol"]), side, self.slippage_bps, is_entry=True)
        add_qty = plan["computed"]["qty"] * add_qty_pct / 100.0
        fee = calc.fee(calc.notional(add_qty, price), self.taker_fee_bps)
        new_qty = tr["qty"] + add_qty
        new_avg = (tr["avg_entry"] * tr["qty"] + price * add_qty) / new_qty
        new_margin = tr["margin"] + calc.margin_required(add_qty, price, tr["leverage"])
        liq = calc.liquidation_price(new_avg, tr["leverage"], side)
        self.store.adjust_balance(tr["account_id"], -(calc.margin_required(add_qty, price, tr["leverage"]) + fee))
        self.store.update_position(tr["id"], qty=new_qty, avg_entry=new_avg, margin=new_margin, liq=liq)
        self.store.add_order(tr["id"], kind="add", price=price, qty=add_qty, fee=fee,
                             actor="claude", status="filled", reason="加仓", filled_at=now)

    # --- 平仓/减仓与结算 -------------------------------------------------

    def _reduce(self, tr: dict, price: float, qty: float, kind: str, actor: str, now) -> None:
        """部分平仓：结算这部分盈亏、释放对应保证金、扣手续费。"""
        side = tr["side"]
        fee = calc.fee(calc.notional(qty, price), self.taker_fee_bps)
        realized = calc.pnl(side, tr["avg_entry"], price, qty)
        released = tr["margin"] * (qty / tr["qty"]) if tr["qty"] > 0 else 0.0
        self.store.adjust_balance(tr["account_id"], released + realized - fee)
        new_qty = tr["qty"] - qty
        new_margin = max(tr["margin"] - released, 0.0)
        self.store.update_position(tr["id"], qty=new_qty, avg_entry=tr["avg_entry"],
                                   margin=new_margin, liq=tr["liquidation_price"])
        self.store.add_order(tr["id"], kind=kind, price=price, qty=qty, fee=fee,
                             actor=actor, status="filled", reason=f"{kind} 减仓", filled_at=now)
        self.store.add_event(tr["id"], f"{kind}_fill", actor, {"price": price, "qty": qty, "pnl": realized})

    def _close(self, tr: dict, price: float, reason: str, actor: str, now) -> None:
        """全平：把剩余仓位按 price 平掉并结算。"""
        if tr["qty"] > 0:
            self._reduce(tr, price, tr["qty"], "exit" if reason in ("manual", "thesis_invalidated") else reason,
                         actor, now)
        self._finalize_close(tr["id"], reason, now)

    def _finalize_close(self, trade_id: int, reason: str, now) -> None:
        tr = self.store.get_trade(trade_id)
        if tr["status"] != "open":
            return
        self.store.close_position(trade_id, closed_at=now)
        self.store.add_event(trade_id, "closed", "engine", {"reason": reason})
        self._save_result(trade_id, reason, now)

    def _save_result(self, trade_id: int, reason: str, now) -> None:
        plan = self.store.plan_versions(trade_id)[0]["plan"]  # v1 计划基准
        tr = self.store.get_trade(trade_id)
        orders = self.store.orders(trade_id)
        side = tr["side"]
        entries = [o for o in orders if o["kind"] in ("entry", "add") and o["status"] == "filled"]
        closes = [o for o in orders if o["kind"] in ("tp", "reduce", "exit", "sl", "liquidation") and o["status"] == "filled"]
        ent_qty = sum(o["qty"] for o in entries) or 1.0
        vwap_entry = sum(o["price"] * o["qty"] for o in entries) / ent_qty
        realized = sum(calc.pnl(side, vwap_entry, o["price"], o["qty"]) for o in closes)
        fees = sum(o["fee"] for o in orders)
        pnl_net = realized - fees
        risk_amount = plan["computed"].get("risk_amount") or 0.0
        entry_margin = next((o for o in entries), None)
        margin0 = plan["computed"].get("margin") or 0.0
        opened = tr["opened_at"]
        holding_s = (now - opened).total_seconds() if opened else 0.0
        outcome = "win" if pnl_net > 1e-6 else "loss" if pnl_net < -1e-6 else "breakeven"
        self.store.save_result(
            trade_id,
            pnl_abs=round(pnl_net, 4),
            pnl_pct=round(pnl_net / margin0 * 100, 4) if margin0 else 0.0,
            realized_r=round(pnl_net / risk_amount, 4) if risk_amount else None,
            planned_r=plan["computed"].get("rr"),
            holding_s=holding_s, exit_reason=reason, outcome=outcome, fees=round(fees, 4),
        )

    # --- 触发重评 / 快照 -------------------------------------------------

    def _maybe_flag_reeval(self, tr: dict, plan: dict, mark: float, now) -> None:
        """价格逼近止损/最近止盈，或到时间止损 → 记一条待重评事件（去重，不重复刷）。"""
        if self._has_open_reeval(tr["id"]):
            return
        reasons = []
        band = self.reeval_band_pct / 100.0
        sl = plan["sl_price"]
        if abs(mark - sl) / mark <= band:
            reasons.append("逼近止损")
        tps = [t["price"] for t in plan["tp_targets"]]
        done = {round(o["price"], 8) for o in self.store.orders(tr["id"]) if o["kind"] == "tp"}
        pending_tps = [p for p in tps if round(p, 8) not in done]
        if pending_tps:
            nearest = min(pending_tps, key=lambda p: abs(p - mark))
            if abs(mark - nearest) / mark <= band:
                reasons.append("逼近止盈")
        if self.time_stop_hours > 0 and tr["opened_at"]:
            if (now - tr["opened_at"]).total_seconds() >= self.time_stop_hours * 3600:
                reasons.append("到时间止损")
        reasons += self._wake_hits(tr, plan, mark, now)  # Claude 自定义唤醒条件
        if reasons:
            self.store.add_event(tr["id"], "needs_review", "engine", {"reasons": reasons, "mark": mark})

    def _wake_hits(self, tr: dict, plan: dict, mark: float, now) -> list[str]:
        """评估计划里 Claude 声明的结构化唤醒条件，返回命中的描述。"""
        conds = plan.get("wake_conditions") or []
        if not conds:
            return []
        margin = tr.get("margin") or 0.0
        upnl_pct = (
            calc.pnl(tr["side"], tr["avg_entry"], mark, tr["qty"]) / margin * 100.0
            if margin > 0 else 0.0
        )
        elapsed_h = (now - tr["opened_at"]).total_seconds() / 3600.0 if tr["opened_at"] else 0.0
        hits = []
        for c in conds:
            t, v = c.get("type"), c.get("value")
            if v is None:
                continue
            if t == "price_above" and mark >= v: hits.append(f"价≥{v}")
            elif t == "price_below" and mark <= v: hits.append(f"价≤{v}")
            elif t == "pnl_pct_above" and upnl_pct >= v: hits.append(f"浮盈≥{v}%")
            elif t == "pnl_pct_below" and upnl_pct <= v: hits.append(f"浮亏≤{v}%")
            elif t == "time_elapsed_hours" and elapsed_h >= v: hits.append(f"持仓≥{v}h")
        return hits

    def _has_open_reeval(self, trade_id: int) -> bool:
        evs = self.store.events(trade_id)
        last_review = max((i for i, e in enumerate(evs) if e["kind"].startswith("adjust_")), default=-1)
        last_need = max((i for i, e in enumerate(evs) if e["kind"] == "needs_review"), default=-1)
        return last_need > last_review

    def _snapshot(self, trade_id: int, mark: float, now) -> None:
        tr = self.store.get_trade(trade_id)
        if tr is None or tr["status"] != "open":
            return
        plan = self.store.active_plan(trade_id)["plan"]
        side = tr["side"]
        upnl = calc.pnl(side, tr["avg_entry"], mark, tr["qty"])
        sl = plan["sl_price"]
        tps = [t["price"] for t in plan["tp_targets"]]
        nearest_tp = min(tps, key=lambda p: abs(p - mark)) if tps else None
        holding_s = (now - tr["opened_at"]).total_seconds() if tr["opened_at"] else 0.0
        self.store.write_position_snapshot(
            trade_id, now, mark=mark, qty=tr["qty"], avg_entry=tr["avg_entry"], margin=tr["margin"],
            upnl=round(upnl, 4), dist_sl=round(mark - sl, 6),
            dist_tp=round(nearest_tp - mark, 6) if nearest_tp is not None else None,
            liq_price=tr["liquidation_price"], holding_s=holding_s,
        )

    # --- 账户权益 --------------------------------------------------------

    def _equity(self, account_id: int) -> float:
        """权益 = 可用现金 + 占用保证金 + 未平仓浮盈亏。"""
        acct = self.store.get_account(account_id)
        if acct is None:
            return 0.0
        eq = acct["balance"] + self.store.used_margin(account_id)
        for tr in self.store.list_open_trades(account_id):
            try:
                mark = self.price_fn(tr["symbol"])
                eq += calc.pnl(tr["side"], tr["avg_entry"], mark, tr["qty"])
            except Exception:  # noqa: BLE001 — 取价失败不影响权益估算
                pass
        return eq
