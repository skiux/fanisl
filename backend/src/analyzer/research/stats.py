"""回测统计（纯函数，stdlib，可单测）：均值/命中率/bootstrap 置信区间/随机零分布。

不引 numpy/scipy——样本量小（几十到几百），stdlib 足够且无依赖。
"""

from __future__ import annotations

import random
from statistics import mean as _mean


def mean(xs: list[float]) -> float:
    return _mean(xs) if xs else float("nan")


def hit_rate(xs: list[float]) -> float:
    """正值占比（前向收益 > 0 的比例）。"""
    return sum(1 for x in xs if x > 0) / len(xs) if xs else float("nan")


def bootstrap_ci(xs: list[float], *, n: int = 10000, lo: float = 2.5, hi: float = 97.5,
                 seed: int = 0) -> tuple[float, float]:
    """对均值做 bootstrap 置信区间（默认 95%）。"""
    if not xs:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    k = len(xs)
    means = sorted(sum(rng.choice(xs) for _ in range(k)) / k for _ in range(n))
    return (means[int(lo / 100 * n)], means[int(hi / 100 * n)])


def random_null_upper(pool: list[float], size: int, *, n: int = 10000,
                      pct: float = 97.5, seed: int = 1) -> float:
    """随机基线：从 pool 里反复抽 size 个算均值，返回该零分布的上分位。

    S 的均值若超过它，说明"比随机挑 size 个进场点更好"（不是运气）。
    """
    if not pool or size <= 0:
        return float("nan")
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(pool) for _ in range(size)) / size for _ in range(n))
    return means[int(pct / 100 * n)]
