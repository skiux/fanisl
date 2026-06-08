"""入库前的取值校验（纯函数，可单测，不联网）：挡掉 NaN/inf 与物理上不可能的越界值。

best-effort：脏样本被丢弃 + 返回原因供采集器记日志，绝不抛异常中断采集。
校验保守——只挡"不可能"的值（如 RSI>100、价格为负、分位>1），不做统计离群判定，
那会误杀真实极端行情（插针、爆仓、费率尖峰本就是要历史化的信号）。
"""

from __future__ import annotations

import math

from .marketstore import Sample

_PCT01 = (0.0, 1.0)        # 分位：0~1
_NONNEG = (0.0, None)      # 非负量：金额 / 张数 / 笔数 / 波动率 / 价格

# 非负量指标全名集合（前缀类在 _bounds 里单独处理）
_NONNEG_METRICS = {
    "open_interest_usd", "dvol", "atm_iv", "options_total_oi",
    "liq_long_24h", "liq_short_24h", "liq_total_24h",
    "chain_tvl", "stablecoin_total", "active_addresses", "tx_count", "fees_usd",
    "lsr", "top_trader_lsr", "put_call_ratio",  # 比率：不可能为负
}


def _bounds(metric: str) -> tuple[float | None, float | None] | None:
    """指标名 → (下界, 上界)，None 侧表示不限；返回 None 表示只查有限性、不限范围。

    可正可负的量（funding/basis/change/macd/skew/oi_change/*_change_*）落到 None 分支。
    """
    if metric.startswith("rsi_") or metric == "fear_greed":
        return (0.0, 100.0)
    # 分位类（含 atr_pct_，需在 atr_ 前判定）
    if metric.endswith("_percentile") or metric.startswith("atr_pct_"):
        return _PCT01
    if metric == "price" or metric.startswith(("atr_", "bb_upper_", "bb_lower_", "vol_ratio_")):
        return _NONNEG
    if metric in _NONNEG_METRICS:
        return _NONNEG
    return None


def clean_samples(samples: list[Sample]) -> tuple[list[Sample], list[str]]:
    """过滤脏样本，返回 (合格样本, 拒绝原因列表)。"""
    good: list[Sample] = []
    bad: list[str] = []
    for s in samples:
        v = s.value
        if v is None or not math.isfinite(v):
            bad.append(f"{s.symbol}/{s.metric}=非有限值({v})")
            continue
        b = _bounds(s.metric)
        if b is not None:
            lo, hi = b
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                bad.append(f"{s.symbol}/{s.metric}={v} 越界[{lo},{hi}]")
                continue
        good.append(s)
    return good, bad
