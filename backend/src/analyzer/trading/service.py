"""交易评测台服务编排：进场 / 自主管理 / 自动复盘，把 agent + engine + store 串起来。

全自主：进场计划过校验即自动执行；持仓中触发重评则自动调 Claude 调整；平仓后自动复盘。
涉及 Claude 的步骤（管理/复盘）best-effort：单笔失败不影响其余，引擎的撮合永远先跑完。
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..config import Settings
from ..data.instruments import tradeable_canonicals
from . import calc
from .engine import TradingEngine
from .models import TradePlan
from .store import TradingStore
from .trade_agent import TradeAgent


class TradingService:
    def __init__(
        self, store: TradingStore, engine: TradingEngine, agent: TradeAgent,
        settings: Settings | None = None,
    ) -> None:
        self.store = store
        self.engine = engine
        self.agent = agent
        self.settings = settings

    # --- 账户概览 --------------------------------------------------------

    def account_summary(self, account_id: int) -> dict:
        acct = self.store.get_account(account_id)
        if acct is None:
            return {}
        opens = self.store.list_open_trades(account_id)
        return {
            "balance": round(acct["balance"], 2),
            "initial_balance": acct["initial_balance"],
            "equity": round(self.engine._equity(account_id), 2),
            "used_margin": round(self.store.used_margin(account_id), 2),
            "max_leverage": acct["max_leverage"],
            "margin_mode": acct["margin_mode"],
            "default_risk_pct": acct["default_risk_pct"],
            "force_trade": bool(acct["force_trade"]),
            "open_positions": [
                {"symbol": t["symbol"], "side": t["side"], "qty": t["qty"], "avg_entry": t["avg_entry"]}
                for t in opens
            ],
        }

    # --- 进场（用户指定标的触发）----------------------------------------

    def open_trade(self, account_id: int, symbol: str) -> dict:
        summary = self.account_summary(account_id)
        force = bool(summary.get("force_trade"))
        d = self.agent.decide_entry(symbol, summary, force=force)  # Claude（慢），不持锁
        if d["kind"] != "plan":
            decline = d["decline"]
            did = self.store.record_decline(
                account_id, symbol, decline.reason, watch_for=decline.watch_for,
                recheck_after_hours=getattr(decline, "recheck_after_hours", None),
                bias_if_forced=getattr(decline, "bias_if_forced", None),
                inputs=d["inputs"], transcript=d["transcript"],
            )
            return {"kind": "decline", "decline_id": did, "reason": decline.reason}

        plan = d["plan"]
        risk_factor, risk_note, atr_daily = self._decision_signals(d["inputs"], plan)
        # 临界区：容量/风险裁决 + 开仓，账户级串行化（防并发越过上限）
        with self.store.account_lock(account_id):
            cap = self._check_capacity(account_id, plan)
            if not cap["ok"]:
                return {"kind": "rejected", "rejected": True, "reason": cap["reason"], "by": "capacity"}
            res = self.engine.open_trade(
                account_id, plan, inputs=d["inputs"], response=d["transcript"],
                risk_factor=risk_factor, risk_note=risk_note, atr_daily=atr_daily,
            )
        return {"kind": "plan", **res}

    def _decision_signals(self, inputs: dict, plan) -> tuple[float, str | None, float | None]:
        """从冻结的决策上下文里提取确定性裁决信号：事件邻近风险打折系数 + 日线 ATR。

        用 Claude 当时看到的同一份数据（catalysts/snapshot），保证可审计、可复现。
        """
        risk_factor, risk_note = 1.0, None
        # 事件邻近打折——event_driven 策略是冲着事件去的，豁免
        if self.settings is not None and plan.strategy_type != "event_driven":
            macro = ((inputs or {}).get("catalysts") or {}).get("macro_calendar") or []
            risk_factor, risk_note = calc.event_risk_factor(
                macro, datetime.now(timezone.utc),
                blackout_hours=self.settings.trading_event_blackout_hours,
                haircut=self.settings.trading_event_risk_haircut,
            )
        # 日线 ATR（TP 可达性校验用）
        atr_daily = None
        tfs = ((inputs or {}).get("snapshot") or {}).get("timeframes") or {}
        atr_daily = ((tfs.get("1d") or {}).get("volatility") or {}).get("atr")
        return risk_factor, risk_note, atr_daily

    def _check_capacity(self, account_id: int, plan) -> dict:
        """确定性容量/风险裁决（Claude 提议、引擎裁决）。返回 {ok, reason}。"""
        if self.settings is None:
            return {"ok": True}
        committed = self.store.committed_trades(account_id)
        max_pos = self.settings.trading_max_positions
        if len(committed) >= max_pos:
            return {"ok": False, "reason": f"已达最大持仓数 {max_pos}"}

        # 同方向集中度上限（避免名义分散实为一注）
        max_same = self.settings.trading_max_same_direction
        if sum(1 for t in committed if t["side"] == plan.side) >= max_same:
            return {"ok": False, "reason": f"同方向({plan.side})持仓已达上限 {max_same}（相关性集中）"}

        # 总在险预算
        equity = self.account_summary(account_id).get("equity") or 0.0
        deployed = 0.0
        for t in committed:
            ap = self.store.active_plan(t["id"]) or {}
            deployed += (ap.get("plan", {}).get("computed", {}) or {}).get("risk_amount") or 0.0
        this_risk = equity * (plan.risk_pct / 100.0)
        budget = equity * self.settings.trading_max_total_risk_pct / 100.0
        if deployed + this_risk > budget + 1e-6:
            return {"ok": False,
                    "reason": f"超总在险预算（已用 {deployed:.0f}＋本笔 {this_risk:.0f} ＞ 上限 {budget:.0f}）"}
        return {"ok": True}

    def open_positions(self, account_id: int) -> list[dict]:
        """持仓实时状态：每笔未平仓交易 + 最新盯市快照 + 计划止损止盈。给前端面板。"""
        out: list[dict] = []
        for t in self.store.list_open_trades(account_id):
            snap = self.store.latest_position_snapshot(t["id"])
            plan = (self.store.active_plan(t["id"]) or {}).get("plan", {})
            out.append({
                "trade_id": t["id"], "symbol": t["symbol"], "side": t["side"],
                "leverage": t["leverage"], "qty": t["qty"], "avg_entry": t["avg_entry"],
                "liquidation_price": t["liquidation_price"], "opened_at": t["opened_at"],
                "sl_price": plan.get("sl_price"),
                "tp_targets": plan.get("tp_targets"),
                "wake_conditions": plan.get("wake_conditions"),
                "mark": (snap or {}).get("mark"),
                "upnl": (snap or {}).get("upnl"),
                "dist_sl": (snap or {}).get("dist_sl"),
                "dist_tp": (snap or {}).get("dist_tp"),
                "holding_s": (snap or {}).get("holding_s"),
                "snapshot_ts": (snap or {}).get("ts"),
            })
        return out

    # --- 自主扫描（定期在全标的里找机会，受仓位/风险上限约束）-----------

    def _scan_universe(self) -> list[str]:
        wl = list(self.settings.watchlist) if self.settings else []
        return list(dict.fromkeys(wl + tradeable_canonicals()))

    def scan(self, account_id: int) -> dict:
        """一轮自主扫描：triage 选候选 → 在容量内逐个做完整决策并开仓。"""
        if self.settings is None:
            return {"error": "settings 未注入"}
        open_trades = self.store.list_open_trades(account_id)
        max_pos = self.settings.trading_max_positions
        pos_cap = max_pos - len(open_trades)
        equity = self.account_summary(account_id).get("equity") or 0.0
        deployed = 0.0
        for t in open_trades:
            ap = self.store.active_plan(t["id"]) or {}
            deployed += (ap.get("plan", {}).get("computed", {}) or {}).get("risk_amount") or 0.0
        risk_budget = equity * self.settings.trading_max_total_risk_pct / 100.0 - deployed
        if pos_cap <= 0 or risk_budget <= 0:
            return {"scanned": 0, "candidates": [], "opened": [],
                    "note": f"已达上限(持仓 {len(open_trades)}/{max_pos}, 在险预算剩 {round(risk_budget,2)})"}

        open_syms = {t["symbol"] for t in open_trades}
        universe = [s for s in self._scan_universe() if s not in open_syms]
        sc = self.agent.scan(universe, max_candidates=pos_cap)
        result = sc["result"]

        opened: list[dict] = []
        for cand in result.candidates[:pos_cap]:
            if len(self.store.list_open_trades(account_id)) >= max_pos:
                break
            try:
                r = self.open_trade(account_id, cand.symbol)
                opened.append({"symbol": cand.symbol, "kind": r.get("kind"),
                               "trade_id": r.get("trade_id"), "reason": r.get("reason")})
            except Exception as e:  # noqa: BLE001
                opened.append({"symbol": cand.symbol, "error": str(e)[:60]})
        return {
            "scanned": len(universe),
            "candidates": [c.model_dump() for c in result.candidates],
            "opened": opened, "market_note": result.market_note, "skipped": sc.get("skipped"),
        }

    # --- 影子账户：机械镜像（免费对照组，无 Claude）---------------------

    def sync_shadows(self, accounts: list[dict]) -> list[dict]:
        """把被镜像账户的新开仓机械复制到影子账户：同样的 v1 计划、引擎自动执行，
        全程无 Claude 管理。这样每笔真实交易都有一个"不管理"的精确对照（管理增益逐笔可算）。
        """
        name_to_id = {a["spec"].name: a["id"] for a in accounts}
        out: list[dict] = []
        for a in accounts:
            spec = a["spec"]
            if spec.managed or not spec.mirror_of:
                continue
            src_id = name_to_id.get(spec.mirror_of)
            if src_id is None:
                continue
            shadow_id = a["id"]
            mirrored = self.store.mirrored_source_ids(shadow_id)
            for tr in self.store.list_open_trades(src_id):
                if tr["id"] in mirrored:
                    continue
                versions = self.store.plan_versions(tr["id"])
                if not versions:
                    continue
                try:
                    plan = TradePlan.model_validate(versions[0]["plan"])
                except Exception:  # noqa: BLE001 — 计划无法重建则跳过
                    continue
                with self.store.account_lock(shadow_id):
                    cap = self._check_capacity(shadow_id, plan)
                    if not cap["ok"]:
                        continue
                    res = self.engine.open_trade(shadow_id, plan, inputs={"mirror_of": tr["id"]})
                if res.get("trade_id"):
                    self.store.add_event(res["trade_id"], "mirrored", "engine",
                                         {"source_trade_id": tr["id"], "source_account": src_id})
                    out.append({"shadow_trade_id": res["trade_id"], "source_trade_id": tr["id"]})
        return out

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

    # --- 拒绝力校验：到期后用价格变动判"不交易"对错 -------------------

    def verify_declines(self, account_id: int) -> list[dict]:
        """到期的不交易决策：朝 bias_if_forced 方向走超过阈值 = 错过机会（判错），否则判对。"""
        from datetime import datetime, timezone
        thr = (self.settings.trading_decline_move_threshold_pct if self.settings else 0.5) / 100.0
        out: list[dict] = []
        for d in self.store.declines_due_recheck(account_id, datetime.now(timezone.utc)):
            price_then = self._inputs_last_price(d.get("inputs"))
            if not price_then:
                continue
            try:
                price_now = self.engine.price_fn(d["symbol"])
            except Exception:  # noqa: BLE001 — 取价失败下次再校验
                continue
            ret = (price_now - price_then) / price_then
            move = ret if d["bias_if_forced"] == "long" else -ret  # 朝 bias 方向的收益
            # 朝该方向显著上涨 = 本可赚 = 拒绝判错（错过）；否则拒绝判对（避开了）
            correct = move <= thr
            outcome = {"correct": correct, "price_then": price_then, "price_now": price_now,
                       "move_pct": round(move * 100, 3), "bias": d["bias_if_forced"]}
            self.store.save_decline_outcome(d["id"], outcome)
            out.append({"decline_id": d["id"], **outcome})
        return out

    @staticmethod
    def _inputs_last_price(inputs) -> float | None:
        tfs = ((inputs or {}).get("snapshot") or {}).get("timeframes") or {}
        for tf in ("5m", "15m", "1h", "4h", "1d"):
            lp = (tfs.get(tf) or {}).get("last_price")
            if lp:
                return float(lp)
        for v in tfs.values():
            if v.get("last_price"):
                return float(v["last_price"])
        return None

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
        """低频部分：响应待重评 + 复盘已平仓（调 Claude）+ 校验到期的不交易决策（纯算）。"""
        return {
            "managed": self.manage_pending(account_id),
            "reviewed": self.review_closed(account_id),
            "declines_verified": self.verify_declines(account_id),
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
