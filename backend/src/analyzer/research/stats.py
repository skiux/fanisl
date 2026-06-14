"""回测统计（纯函数，stdlib，可单测）：均值/命中率/bootstrap 置信区间/随机零分布。

不引 numpy/scipy——样本量小（几十到几百），stdlib 足够且无依赖。
"""

from __future__ import annotations

import math
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


def ranks(xs: list[float]) -> list[float]:
    """平均秩（处理并列）：返回每个元素的 1..n 秩，并列取平均秩。"""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1  # 1-based 平均秩
        for k in range(i, j + 1):
            out[order[k]] = avg
        i = j + 1
    return out


def spearman(xs: list[float], ys: list[float]) -> float:
    """Spearman 秩相关 = 秩上的 Pearson。退化（方差 0）返回 nan。"""
    if len(xs) != len(ys) or len(xs) < 3:
        return float("nan")
    rx, ry = ranks(xs), ranks(ys)
    n = len(rx)
    mx, my = _mean(rx), _mean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx)
    vy = sum((b - my) ** 2 for b in ry)
    if vx <= 0 or vy <= 0:
        return float("nan")
    return cov / math.sqrt(vx * vy)


def _norm_sf(z: float) -> float:
    """标准正态上尾 P(Z>z)。"""
    return 0.5 * math.erfc(z / math.sqrt(2))


def corr_pvalue(r: float, n: int) -> float:
    """相关系数 r（n 个样本）的双边 p 值，大样本正态近似（t≈z）。"""
    if n < 4 or not (-1 < r < 1):
        return float("nan")
    z = abs(r) * math.sqrt((n - 2) / (1 - r * r))
    return 2 * _norm_sf(z)


def bh_fdr(pvals: list[float], q: float = 0.10) -> list[bool]:
    """Benjamini-Hochberg FDR：返回每个 p 是否在 q 水平显著（控制多重检验假阳）。"""
    idx = [i for i, p in enumerate(pvals) if p == p]  # 非 nan
    m = len(idx)
    if m == 0:
        return [False] * len(pvals)
    order = sorted(idx, key=lambda i: pvals[i])
    out = [False] * len(pvals)
    kmax = -1
    for rank, i in enumerate(order, start=1):
        if pvals[i] <= q * rank / m:
            kmax = rank
    for rank, i in enumerate(order, start=1):
        if rank <= kmax:
            out[i] = True
    return out
