"""联赛表的显著性口径：sign 类判断 vs **市场自身的无技能基线**。

为什么不能用 50%
----------------
二项检验拿 50% 当零假设，等于假设"涨跌各半、瞎猜一半对"。语料里不是这样：判断以 up 向
居多，而评分窗口又落在一段上行行情里，所以一个毫无技能、只按各标的无条件漂移下注的
预测者本来就能拿到 50% 以上。2026-08-14 实测三个信源的无技能基线分别是 50.6% / 43.6% /
**59.2%**——投资TALK君那条偏离将近 10 个百分点，他的 p 值因此从 0.0017 虚高到真实的 0.046。

口径
----
对每条已评的 sign claim，按它自己的标的与窗口长度，从 daily_bars 里数**无条件频率**：
方向 up 就数"该标的在同样长的窗口里上涨的比例"，down 数下跌比例，flat 数落在 ±band 内的
比例。这就是"不看未来、只按这个标的的漂移下注"能拿到的命中率 p_i。各条 p_i 不同，所以
零分布是 **Poisson-binomial**（各次成功概率不等的二项），不是普通二项——用 DP 精确求尾概率。

三条已知局限（读数时自行折价，不要当成严格统计推断）
--------------------------------------------------
1. **基线是样本内的**：daily_bars 只回填到 2026-05-01，没有独立的参照期可用，基线用的就是
   claim 自己所处的那段行情。它能纠正"上行市里 up 向判断天然占便宜"，但纠正不了 regime 本身。
2. **窗口重叠**：重叠窗口的有效样本数远小于窗口个数，基线点估计比它看上去更不稳。
3. **口径被 override 改写的不计入**：mode（close_at_eval / touch / max_drawdown_lt）与
   baseline_date 这几类 override 把判据换成了绝对水平或非方向判定，无法映射成"方向的无条件
   频率"，这些 claim 从显著性检验里剔除并单独计数，只留在命中率里。
   ref_factor 与 band 这两类只是挪了阈值，能对应到 P(收益率 ≥ factor-1) 之类，照常计入。

   **剔除不是中性的，所以要把方向暴露出来**：2026-08-14 的实际剔除是投资TALK君 2 miss+1 hit、
   Andy 1 miss+2 hit——单看检验子集，TALK君从 21/28=75% 变成 20/25=80%，被剔掉的恰是他那
   两条关于加息的错判（#651/#670，全库最有分量的两条）。所以返回里给的是
   `excluded_hits`/`excluded_misses` 而不只是一个总数，且**头条命中率始终用全部 claim**，
   检验子集单独标 `tested_*`，不许拿子集冒充战绩。
   DFEDTARU 这类政策利率之所以给不出基线，是因为 daily_bars 只有 3 个多月、期间读数一直
   没动，P(上调) 估出来是 0——要真给它基线得单独回填多年 FRED 历史按 FOMC 窗口数，留待后续。
"""

from __future__ import annotations

import datetime as dt

from .scorers import OVERRIDES

# 让基线与 _score_sign 用同一套默认阈值
_DEFAULT_BAND = 0.02
# 这几类 override 把 sign 的判据换掉了，基线无从对应
_MODE_KEYS = ("mode", "baseline_date")
_MIN_WINDOWS = 8          # 少于这么多个重叠窗口就不给基线（估计不可用）
_TRADING_DAYS_PER_WEEK = 5 / 7


def _bars_by_symbol(conn) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for r in conn.execute("SELECT symbol, close FROM daily_bars ORDER BY symbol, ts"):
        out.setdefault(r["symbol"], []).append(float(r["close"]))
    return out


def base_rate(closes: list[float], win_days: int, direction: str | None,
              *, factor: float = 1.0, band: float = _DEFAULT_BAND) -> float | None:
    """该标的在 win_days 自然日的窗口里，朝 direction 走的无条件频率。

    判据镜像 scorers._score_sign：up=收盘≥ref*factor，down=<，其余=|收益率|≤band。
    """
    k = max(1, round(win_days * _TRADING_DAYS_PER_WEEK))
    if len(closes) <= k:
        return None
    rets = [closes[i + k] / closes[i] - 1 for i in range(len(closes) - k)]
    if len(rets) < _MIN_WINDOWS:
        return None
    thr = factor - 1.0
    if direction == "up":
        hits = sum(r >= thr for r in rets)
    elif direction == "down":
        hits = sum(r < thr for r in rets)
    else:
        hits = sum(abs(r) <= band for r in rets)
    return hits / len(rets)


def poisson_binomial_tail(k: int, ps: list[float], *, upper: bool) -> float:
    """P(X≥k)（upper）或 P(X≤k)：各次成功概率不等的二项，DP 精确卷积。"""
    dist = [1.0]
    for p in ps:
        nxt = [0.0] * (len(dist) + 1)
        for i, v in enumerate(dist):
            nxt[i] += v * (1.0 - p)
            nxt[i + 1] += v * p
        dist = nxt
    return sum(dist[k:]) if upper else sum(dist[: k + 1])


def sign_stats(pool) -> dict[int, dict]:
    """按信源汇总 sign 类战绩 + 市场基线 + Poisson-binomial 显著性。

    观测单位是 **claim**（一条 claim 的多个阶梯时点按多数决折成一票），不是评分行——
    同一判断的多次时点高度相关，当成独立观测会把 n 灌水、p 值虚低。
    """
    with pool.connection() as conn:
        closes = _bars_by_symbol(conn)
        rows = conn.execute("""
            SELECT u.creator_id, s.unit_id, s.outcome,
                   u.payload->>'asset_symbol'  AS sym,
                   u.payload->>'direction'     AS dir,
                   s.horizon_label::date - u.published_at::date AS win_days
            FROM claim_scores s JOIN knowledge_units u ON u.id = s.unit_id
            WHERE u.payload->'scoring_spec'->>'method' = 'sign'
              AND s.outcome IN ('hit', 'miss')
              AND s.horizon_label ~ '^[0-9]{4}-'
        """).fetchall()

    per_claim: dict[int, dict] = {}
    for r in rows:
        c = per_claim.setdefault(r["unit_id"], {
            "creator_id": r["creator_id"], "hits": 0, "n": 0, "rates": [],
            "sym": r["sym"], "dir": r["dir"],
        })
        c["n"] += 1
        c["hits"] += r["outcome"] == "hit"
        ov = OVERRIDES.get(str(r["unit_id"]), {})
        if any(key in ov for key in _MODE_KEYS):
            c["rates"] = None          # 判据被改写，无法给基线
        elif c["rates"] is not None:
            br = base_rate(closes.get(r["sym"]) or [], r["win_days"], r["dir"],
                           factor=ov.get("ref_factor", 1.0),
                           band=ov.get("band", _DEFAULT_BAND))
            if br is None:
                c["rates"] = None
            else:
                c["rates"].append(br)

    out: dict[int, dict] = {}
    for c in per_claim.values():
        g = out.setdefault(c["creator_id"], {
            "n": 0, "hits": 0, "ps": [], "excluded_hits": 0, "excluded_misses": 0})
        hit = c["hits"] * 2 >= c["n"]          # 阶梯多数决
        g["n"] += 1
        g["hits"] += hit
        if c["rates"]:
            g["ps"].append(sum(c["rates"]) / len(c["rates"]))
            g.setdefault("tested", []).append(hit)
        else:
            g["excluded_hits" if hit else "excluded_misses"] += 1

    for g in out.values():
        tested = g.pop("tested", [])
        ps = g.pop("ps")
        if ps and len(ps) == len(tested):
            k, n = sum(tested), len(tested)
            baseline = sum(ps) / n
            above = k >= baseline * n
            g["baseline"] = round(baseline, 3)
            g["tested_n"], g["tested_hits"] = n, k
            g["p"] = round(poisson_binomial_tail(k, ps, upper=above)
                           if above else poisson_binomial_tail(k, ps, upper=False), 4)
            g["side"] = "above" if above else "below"
        else:
            g["baseline"] = g["p"] = g["side"] = None
            g["tested_n"] = g["tested_hits"] = 0
    return out
