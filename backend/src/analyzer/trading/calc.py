"""纸面永续交易的确定性数学（纯函数，可单测，不依赖 DB/网络）。

仓位反推、盈亏比、强平价、盈亏、手续费/滑点、计划校验。引擎与会计的真相在这里，
Claude 不参与这些计算——它只给点位与依据，数字由这里算、由这里核对。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .models import Side, TpTarget

MAINT_MARGIN_RATE = 0.005  # 维持保证金率（强平价近似用）


def _parse_iso(s: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def event_risk_factor(
    macro_calendar: list[dict], now: datetime, *,
    blackout_hours: float, haircut: float,
) -> tuple[float, str | None]:
    """高影响宏观事件临近 → 线性风险打折系数（非粗暴拒绝）。

    返回 (factor, note)。factor∈[haircut,1]：事件还有 blackout_hours 以上 → 1.0（不打折）；
    越临近越接近 haircut（事件时刻 = haircut）。只看 importance=high 且在未来的事件。
    """
    nearest_h: float | None = None
    nearest_name = ""
    for ev in macro_calendar or []:
        if str(ev.get("importance", "")).lower() != "high":
            continue
        dt = _parse_iso(ev.get("date"))
        if dt is None:
            continue
        hours = (dt - now).total_seconds() / 3600.0
        if 0 <= hours <= blackout_hours and (nearest_h is None or hours < nearest_h):
            nearest_h, nearest_name = hours, ev.get("name", "事件")
    if nearest_h is None:
        return 1.0, None
    factor = haircut + (1.0 - haircut) * (nearest_h / blackout_hours)
    return round(factor, 4), f"{nearest_name} 还有 {nearest_h:.1f}h"


def tp_reachable(
    entry: float, tp1: float, atr_daily: float, holding_hours: float, k: float,
) -> tuple[bool, float]:
    """TP1 在预期持有期内结构上是否够得着。

    预期波动幅度 ≈ ATR(日) × √(持有小时/24)；可达 = |TP1-entry| ≤ k × 预期幅度。
    返回 (reachable, expected_range)。数据不足（atr/holding 缺）时按可达处理（不拦）。
    """
    if not atr_daily or not holding_hours or holding_hours <= 0:
        return True, 0.0
    expected = atr_daily * (holding_hours / 24.0) ** 0.5
    return abs(tp1 - entry) <= k * expected, expected


def position_size(equity: float, risk_pct: float, entry: float, sl: float) -> float:
    """按「单笔风险 = 权益×risk% = 数量×止损距离」反推数量（base 单位，如 BTC）。"""
    per_unit_risk = abs(entry - sl)
    if per_unit_risk <= 0:
        return 0.0
    risk_amount = equity * (risk_pct / 100.0)
    return risk_amount / per_unit_risk


def notional(qty: float, price: float) -> float:
    return qty * price


def margin_required(qty: float, entry: float, leverage: float) -> float:
    if leverage <= 0:
        return float("inf")
    return notional(qty, entry) / leverage


def fee(notional_usd: float, bps: float) -> float:
    return abs(notional_usd) * (bps / 10_000.0)


def apply_slippage(price: float, side: Side, bps: float, *, is_entry: bool) -> float:
    """市价成交滑点：进多/平空买入价偏高，进空/平多卖出价偏低（永远对自己不利）。"""
    frac = bps / 10_000.0
    buying = (side == "long") == is_entry  # 进多 or 平空 = 买入
    return price * (1 + frac) if buying else price * (1 - frac)


def liquidation_price(entry: float, leverage: float, side: Side) -> float:
    """逐仓强平价近似：亏到保证金耗尽（扣维持保证金）。仅作纸面建模，非交易所精确公式。"""
    if leverage <= 0:
        return 0.0
    move = 1.0 / leverage - MAINT_MARGIN_RATE
    if side == "long":
        return max(entry * (1 - move), 0.0)
    return entry * (1 + move)


def pnl(side: Side, avg_entry: float, exit_price: float, qty: float) -> float:
    """已/浮动盈亏（USDT，不含手续费）。"""
    diff = (exit_price - avg_entry) if side == "long" else (avg_entry - exit_price)
    return diff * qty


def reward_risk(entry: float, sl: float, tps: list[TpTarget], side: Side) -> float | None:
    """盈亏比 = 加权潜在盈利 / 潜在亏损（每单位）。

    按各 TP 的减仓比例加权；若减仓比例合计 <100%，剩余部分假定持有到最后一个目标。
    """
    risk = abs(entry - sl)
    if risk <= 0 or not tps:
        return None
    total_reduce = 0.0
    reward = 0.0
    for t in tps:
        frac = max(t.reduce_pct, 0.0) / 100.0
        reward += frac * abs(t.price - entry)
        total_reduce += t.reduce_pct
    remainder = max(0.0, 100.0 - total_reduce) / 100.0
    if remainder > 0:
        reward += remainder * abs(tps[-1].price - entry)
    return reward / risk


def mfe_mae_r(upnls: list[float], risk_amount: float) -> tuple[float | None, float | None]:
    """从盯市浮盈亏序列算最大有利/不利波动（以风险额 R 为单位）。"""
    if not upnls or risk_amount <= 0:
        return None, None
    return round(max(upnls) / risk_amount, 4), round(min(upnls) / risk_amount, 4)


def counterfactual_r(
    side: Side, entry: float, sl: float, tp1: float | None,
    marks: list[float], qty: float, last_mark: float, risk_amount: float,
) -> float | None:
    """反事实「不做任何管理」基准 R：从入场起走盯市价，原始 SL / TP1 谁先到。

    SL 先到 → -1R；TP1 先到 → 计划到 TP1 的盈亏比；都没到 → 按最后一帧标记价核算。
    管理层贡献 = 实际 R − 反事实 R（提前砍/移损/减仓相对"拿住不动"赚了多少）。
    """
    if risk_amount <= 0:
        return None
    risk_dist = abs(entry - sl)
    for m in marks:
        if side == "long":
            if m <= sl:
                return -1.0
            if tp1 is not None and m >= tp1:
                return round(abs(tp1 - entry) / risk_dist, 4) if risk_dist else None
        else:
            if m >= sl:
                return -1.0
            if tp1 is not None and m <= tp1:
                return round(abs(tp1 - entry) / risk_dist, 4) if risk_dist else None
    return round(pnl(side, entry, last_mark, qty) / risk_amount, 4)


@dataclass
class PlanCheck:
    ok: bool
    issues: list[str] = field(default_factory=list)   # 硬问题：方向错/超杠杆/超保证金
    flags: list[str] = field(default_factory=list)     # 软提示：盈亏比偏低（记录不拦）
    qty: float = 0.0
    notional: float = 0.0
    margin: float = 0.0
    rr: float | None = None
    liquidation_price: float = 0.0


def validate_plan(
    *,
    side: Side,
    entry: float,
    sl: float,
    tps: list[TpTarget],
    leverage: float,
    risk_pct: float,
    equity: float,
    available_margin: float,
    max_leverage: float,
    min_rr: float,
    atr_daily: float | None = None,
    holding_hours: float | None = None,
    tp_reach_k: float = 1.5,
) -> PlanCheck:
    """校验进场计划并算出仓位/保证金/盈亏比/强平价。

    硬问题(issues)→ 计划无效(本身是质量信号)；软提示(flags)如盈亏比偏低只记录、不拦截
    （让 Claude 自负纪律，事后评测它有没有守自己的规矩）。
    """
    issues: list[str] = []
    flags: list[str] = []

    # 方向一致性
    if side == "long":
        if not sl < entry:
            issues.append(f"多单止损({sl})应低于进场({entry})")
        if any(t.price <= entry for t in tps):
            issues.append("多单止盈应高于进场")
    else:
        if not sl > entry:
            issues.append(f"空单止损({sl})应高于进场({entry})")
        if any(t.price >= entry for t in tps):
            issues.append("空单止盈应低于进场")

    if not tps:
        issues.append("缺少止盈目标")
    bad_reduce = sum(t.reduce_pct for t in tps) > 100.0 + 1e-9
    if bad_reduce:
        issues.append("止盈减仓比例合计超过 100%")
    if leverage <= 0 or leverage > max_leverage:
        issues.append(f"杠杆 {leverage} 超出范围 (0, {max_leverage}]")
    if risk_pct <= 0:
        issues.append("风险% 必须为正")

    qty = position_size(equity, risk_pct, entry, sl) if entry != sl else 0.0
    notion = notional(qty, entry)
    margin = margin_required(qty, entry, leverage) if leverage > 0 else float("inf")
    rr = reward_risk(entry, sl, tps, side)
    liq = liquidation_price(entry, leverage, side)

    if margin > available_margin + 1e-6:
        issues.append(f"所需保证金 {margin:.2f} 超过可用 {available_margin:.2f}")
    if rr is not None and rr < min_rr:
        flags.append(f"盈亏比 {rr:.2f} 低于建议 {min_rr}")

    # TP1 可达性：目标要在预期持有期内结构上够得着，别为凑盈亏比画太远
    if tps and atr_daily and holding_hours:
        reachable, expected = tp_reachable(entry, tps[0].price, atr_daily, holding_hours, tp_reach_k)
        if not reachable:
            flags.append(
                f"TP1 距入场 {abs(tps[0].price - entry):.2f}，超过 {holding_hours:.0f}h 预期幅度"
                f"{expected:.2f}×{tp_reach_k}（目标可能够不着）"
            )

    return PlanCheck(
        ok=not issues,
        issues=issues,
        flags=flags,
        qty=qty,
        notional=notion,
        margin=margin,
        rr=rr,
        liquidation_price=liq,
    )
