"""Playbook 层：被研究验证（或候选）的 setup 注册表 + 确定性探测器 + 计划模板。

评测台重定位的核心：进场由这里的确定性规则发起（先验来自回测、写死在 spec 里），
Claude 只做闸门（干净实例 + 定性否决），不选方向、不定点位。
定义随代码走 git（与 prereg 文档同源同纪律）；DB 只存 trades.setup_key 关联与触发记录。

探测器 = 纯函数（吃价格序列，可单测）+ 一个薄的取数包装（research/pit 的时点语义）。
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Literal

from pydantic import BaseModel

from ..research import pit
from .models import Side, TpTarget, TradePlan

Point = tuple[datetime, float]
SetupStatus = Literal["candidate", "validated", "retired"]


class BacktestPrior(BaseModel):
    """回测先验（来自预注册回测，Claude 的信念来源）。数值单位见各字段注释。"""
    n: int                      # 回测触发次数
    hit_rate: float             # 命中率（0~1）
    avg_net_return: float       # 平均净收益/笔（名义本金比例，扣费）
    ci_low: float               # bootstrap CI 下限（同上单位）
    holding_hours: float        # 回测持有期
    source: str                 # prereg 文档路径
    regime_notes: str           # 适用/失效 regime 的诚实说明


class SetupSpec(BaseModel):
    key: str
    name: str
    hypothesis_ref: str         # 对应研究假设编号（如 H7）
    status: SetupStatus
    symbols: list[str]
    # 交易模板（方向由探测器给，点位按下面参数确定性构造）
    risk_pct: float = 0.5
    leverage: float = 2.0
    sl_atr_mult: float = 3.0    # 止损 = 入场 ∓ 此倍数 × 日 ATR 代理
    sl_fallback_pct: float = 10.0  # ATR 不可得时的兜底止损百分比
    tp_atr_mult: float = 6.0    # 止盈 = 入场 ± 此倍数 × 日 ATR 代理（主要出场是到时）
    holding_hours: float = 168.0   # 到时平仓（time_exit_hours）
    cooldown_hours: float = 168.0  # 同 setup×标的 两次触发的最小间隔（防电平信号连开）
    prior: BacktestPrior


@dataclass
class SetupSignal:
    """探测器的触发输出：方向 + 参考价 + 触发时的特征值（落库供审计/闸门用）。"""
    side: Side
    ref_price: float
    atr_daily: float | None
    features: dict = field(default_factory=dict)


# --- 探测器（纯函数部分可单测）--------------------------------------------

_FRESH_MAX_AGE_H = 2.0  # 最新价陈旧超过此小时数 → 数据不新鲜，不触发


def _asof_point(points: list[Point], t: datetime) -> Point | None:
    ts = [p[0] for p in points]
    i = bisect_right(ts, t) - 1
    return points[i] if i >= 0 else None


def daily_atr_proxy(points: list[Point], now: datetime, days: int = 14) -> float | None:
    """日 ATR 代理：近 days 天逐日 |close(t) − close(t−24h)| 的均值（只用收盘序列，无新数据依赖）。"""
    moves = []
    for d in range(days):
        a = _asof_point(points, now - timedelta(days=d))
        b = _asof_point(points, now - timedelta(days=d + 1))
        if a is None or b is None:
            break
        moves.append(abs(a[1] - b[1]))
    if len(moves) < 5:
        return None
    return sum(moves) / len(moves)


def tsmom_signal(points: list[Point], now: datetime, lookback_days: float = 7.0) -> SetupSignal | None:
    """H7 TSMOM：sign(近 lookback 收益) 定方向（sign-only，与预注册一致，无阈值）。

    不触发的情形：序列不足、7d 前无数据、最新价陈旧（> _FRESH_MAX_AGE_H）、收益恰为 0。
    """
    if not points:
        return None
    p_now = _asof_point(points, now)
    p_prev = _asof_point(points, now - timedelta(days=lookback_days))
    if p_now is None or p_prev is None or p_prev[1] <= 0:
        return None
    if (now - p_now[0]).total_seconds() > _FRESH_MAX_AGE_H * 3600:
        return None
    ret = p_now[1] / p_prev[1] - 1.0
    if ret == 0:
        return None
    return SetupSignal(
        side="long" if ret > 0 else "short",
        ref_price=p_now[1],
        atr_daily=daily_atr_proxy(points, now),
        features={
            "ret_lookback": round(ret, 6),
            "lookback_days": lookback_days,
            "price": p_now[1],
            "price_lookback_ago": p_prev[1],
            "price_ts": p_now[0].isoformat(),
        },
    )


def _detect_tsmom_7d(pool, symbol: str, now: datetime) -> SetupSignal | None:
    return tsmom_signal(pit.load_series(pool, symbol, "price"), now)


# --- 注册表 -----------------------------------------------------------------

# H7：唯一全判据 PASS 过的 setup，但时间两半检验显示 regime 依赖（只在强趋势段有效）
# → status=candidate：只进纸面评测账户积累 live-vs-backtest 对照，不可当 edge 信任。
H7_TSMOM = SetupSpec(
    key="tsmom_7d",
    name="TSMOM 7d（时序动量，7 天回看 → 7 天持有）",
    hypothesis_ref="H7",
    status="candidate",
    symbols=["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    risk_pct=0.5,
    leverage=2.0,
    holding_hours=168.0,
    cooldown_hours=168.0,
    prior=BacktestPrior(
        n=432, hit_rate=0.56, avg_net_return=0.0128, ci_low=0.0044, holding_hours=168.0,
        source="doc/phase3-H7-tsmom-longhorizon-prereg.md",
        regime_notes="全样本 PASS 但两半检验不稳：上半（强下行趋势）+2.15%、下半（方向均衡）-0.27%。"
                     "只在强趋势 regime 有效，震荡/反转期失效。candidate=仅纸面验证。",
    ),
)

SETUPS: list[SetupSpec] = [H7_TSMOM]
DETECTORS: dict[str, Callable[..., SetupSignal | None]] = {"tsmom_7d": _detect_tsmom_7d}


def active_setups() -> list[SetupSpec]:
    return [s for s in SETUPS if s.status != "retired"]


def get_setup(key: str) -> SetupSpec | None:
    return next((s for s in SETUPS if s.key == key), None)


def register(spec: SetupSpec, detector: Callable[..., SetupSignal | None]) -> None:
    """注册/覆盖一个 setup（测试注入用；生产 setup 直接写在本文件里走 git 审阅）。"""
    DETECTORS[spec.key] = detector
    existing = next((i for i, s in enumerate(SETUPS) if s.key == spec.key), None)
    if existing is None:
        SETUPS.append(spec)
    else:
        SETUPS[existing] = spec


def unregister(key: str) -> None:
    DETECTORS.pop(key, None)
    SETUPS[:] = [s for s in SETUPS if s.key != key]


def detect(spec: SetupSpec, pool, symbol: str, now: datetime) -> SetupSignal | None:
    fn = DETECTORS.get(spec.key)
    return fn(pool, symbol, now) if fn else None


# --- 计划模板 ---------------------------------------------------------------

def build_plan(spec: SetupSpec, symbol: str, sig: SetupSignal) -> TradePlan:
    """按 setup 模板确定性构造 TradePlan：方向/点位/风险全由规则给出，非 Claude。"""
    entry = sig.ref_price
    if sig.atr_daily and sig.atr_daily > 0:
        sl_dist = spec.sl_atr_mult * sig.atr_daily
        tp_dist = spec.tp_atr_mult * sig.atr_daily
        sl_basis = f"{spec.sl_atr_mult}×日ATR代理({sig.atr_daily:.4g})"
    else:
        sl_dist = entry * spec.sl_fallback_pct / 100.0
        tp_dist = sl_dist * (spec.tp_atr_mult / spec.sl_atr_mult)
        sl_basis = f"ATR 不可得，兜底 {spec.sl_fallback_pct}%"
    sign = 1.0 if sig.side == "long" else -1.0
    return TradePlan(
        symbol=symbol,
        side=sig.side,
        strategy_type="trend",
        thesis=f"[{spec.key}] {spec.name}：触发 {sig.features}",
        setup_key=spec.key,
        entry_type="market",
        entry_price=entry,
        entry_trigger=f"setup {spec.key} 确定性触发",
        leverage=spec.leverage,
        risk_pct=spec.risk_pct,
        sl_price=entry - sign * sl_dist,
        sl_basis=sl_basis,
        tp_targets=[TpTarget(price=entry + sign * tp_dist, reduce_pct=100.0)],
        expected_holding_hours=spec.holding_hours,
        time_exit_hours=spec.holding_hours,
    )
