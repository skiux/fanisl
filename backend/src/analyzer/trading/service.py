"""交易评测台服务编排：进场 / 自主管理 / 自动复盘，把 agent + engine + store 串起来。

全自主：进场计划过校验即自动执行；持仓中触发重评则自动调 Claude 调整；平仓后自动复盘。
涉及 Claude 的步骤（管理/复盘）best-effort：单笔失败不影响其余，引擎的撮合永远先跑完。
"""

from __future__ import annotations

from .engine import TradingEngine
from .store import TradingStore
from .trade_agent import TradeAgent


class TradingService:
    def __init__(self, store: TradingStore, engine: TradingEngine, agent: TradeAgent) -> None:
        self.store = store
        self.engine = engine
        self.agent = agent

    # --- 账户概览 --------------------------------------------------------

    def account_summary(self, account_id: int) -> dict:
        acct = self.store.get_account(account_id)
        if acct is None:
            return {}
        opens = self.store.list_open_trades(account_id)
        return {
            "balance": round(acct["balance"], 2),
            "equity": round(self.engine._equity(account_id), 2),
            "used_margin": round(self.store.used_margin(account_id), 2),
            "max_leverage": acct["max_leverage"],
            "default_risk_pct": acct["default_risk_pct"],
            "open_positions": [
                {"symbol": t["symbol"], "side": t["side"], "qty": t["qty"], "avg_entry": t["avg_entry"]}
                for t in opens
            ],
        }

    # --- 进场（用户指定标的触发）----------------------------------------

    def open_trade(self, account_id: int, symbol: str) -> dict:
        summary = self.account_summary(account_id)
        d = self.agent.decide_entry(symbol, summary)
        if d["kind"] == "plan":
            res = self.engine.open_trade(
                account_id, d["plan"], inputs=d["inputs"], response=d["transcript"]
            )
            return {"kind": "plan", **res}
        decline = d["decline"]
        did = self.store.record_decline(
            account_id, symbol, decline.reason, watch_for=decline.watch_for,
            inputs=d["inputs"], transcript=d["transcript"],
        )
        return {"kind": "decline", "decline_id": did, "reason": decline.reason}

    # --- 持仓中自主管理 --------------------------------------------------

    def manage_pending(self, account_id: int) -> list[dict]:
        acted: list[dict] = []
        for tr in self.store.list_open_trades(account_id):
            if not self.store.reeval_pending(tr["id"]):
                continue
            try:
                plan = self.store.active_plan(tr["id"])["plan"]
                d = self.agent.decide_management(tr, plan, self._position_state(tr["id"]))
                out = self.engine.apply_adjustment(tr["id"], d["adjustment"], response=d["transcript"])
                acted.append({"trade_id": tr["id"], **out})
            except Exception as e:  # noqa: BLE001 — best-effort，引擎撮合不受影响
                self.store.add_event(tr["id"], "manage_error", "engine", {"error": str(e)[:200]})
        return acted

    # --- 平仓后自动复盘 --------------------------------------------------

    def review_closed(self, account_id: int) -> list[int]:
        done: list[int] = []
        for tr in self.store.closed_without_review(account_id):
            try:
                r = self.agent.review_trade(self.store.timeline(tr["id"]))
                self.store.save_review(tr["id"], r["review"].model_dump())
                done.append(tr["id"])
            except Exception as e:  # noqa: BLE001
                self.store.add_event(tr["id"], "review_error", "engine", {"error": str(e)[:200]})
        return done

    # --- 调度：快盯市 / 慢管理，分开两个节奏 ----------------------------

    def mark(self, account_id: int) -> list[dict]:
        """高频确定性盯市：撮合限价进场、止损止盈强平、写快照、触发重评。无活跃交易则跳过。"""
        trades = self.store.list_trades(account_id)
        if not any(t["status"] in ("open", "planned") for t in trades):
            return []
        return self.engine.tick(account_id)

    def manage_and_review(self, account_id: int) -> dict:
        """低频 Claude 部分：响应待重评 + 复盘已平仓（best-effort）。"""
        return {
            "managed": self.manage_pending(account_id),
            "reviewed": self.review_closed(account_id),
        }

    def cycle(self, account_id: int) -> dict:
        """一次性全推进（手动「推进一拍」用）：盯市 + 管理 + 复盘。"""
        actions = self.engine.tick(account_id)  # 确定性，必须先跑完
        managed = self.manage_pending(account_id)
        reviewed = self.review_closed(account_id)
        return {"actions": actions, "managed": managed, "reviewed": reviewed}

    # --- 内部 ------------------------------------------------------------

    def _position_state(self, trade_id: int) -> dict:
        tr = self.store.get_trade(trade_id)
        snaps = self.store.position_snapshots(trade_id)
        last = snaps[-1] if snaps else None
        state = {
            "qty": tr["qty"], "avg_entry": tr["avg_entry"], "margin": tr["margin"],
            "liquidation_price": tr["liquidation_price"],
        }
        if last:
            state.update({
                "mark": last["mark"], "unrealized_pnl": last["upnl"],
                "dist_sl": last["dist_sl"], "dist_tp": last["dist_tp"],
                "holding_seconds": last["holding_s"],
            })
        return state
