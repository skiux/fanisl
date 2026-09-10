"""盈利预期修正（前瞻 EPS 的一致预期怎么被改的）——杀估值良性/恶性的分界指标。

为什么要这条数据
----------------
2026-08-14 拉 15 只大票的横截面：前瞻 EPS 修正中位数 **+4.1%**，倍数变化中位数 **-7.4%**，
11/15 倍数压缩但只有 3/15 盈利被下修。也就是说"杀估值"不是未来风险，过去 90 天一直在跑，
只是跑的是良性版本——倍数在压、盈利在涨，股价扛得住。

良性变成戴维斯双杀，差的就是**盈利预期掉头**这一步。特斯拉是当时唯一走到那一步的：
前瞻 EPS 90 天 -13.0%（其余中位数 +4.1%）、最近 7 天 21 家下调 2 家上调，倍数却只压了
7.8% 还挂在 152 倍——跌了 20% 一点没变便宜，因为分子分母一起掉。

这条数据的价值在于它**领先价格**，且能把 merge-guide 里 node 342（不对称风险先备应对表）
从一段文字变成机械触发：持仓按"EPS 90 天修正 >0 / <0"分两组，后者优先设止损。

口径与陷阱
----------
- yfinance 的 `eps_trend` 给 0q/+1q/0y/+1y 四个期次在 current/7d/30d/60d/90d 的一致预期。
  **0y 会在财年切换时跳变**（谷歌实测从 14.24 跳到 20.58），那不是修正、是换了个年份，
  所以默认只存 `+1y`（下一财年），跨期可比。
- 与 daily_bars 一样按 (symbol, period, asof) 幂等 upsert；asof 用采集日，一天一行。
- 抓不到就跳过，不写半行——空值会让"修正为 0"和"没数据"混淆。
"""

from __future__ import annotations

import datetime as dt
import sys

from psycopg.types.json import Json

from ..config import get_settings
from ..db import make_pool

# 只跟踪知识库里出现过、且有卖方覆盖的个股（ETF/指数/商品没有一致预期）
_SCHEMA = """
CREATE TABLE IF NOT EXISTS eps_estimates (
    symbol     TEXT NOT NULL,
    period     TEXT NOT NULL,          -- 0q|+1q|0y|+1y（默认只存 +1y，见模块顶注）
    asof       DATE NOT NULL,          -- 采集日
    current    DOUBLE PRECISION,
    d7         DOUBLE PRECISION,       -- 7 天前的一致预期
    d30        DOUBLE PRECISION,
    d60        DOUBLE PRECISION,
    d90        DOUBLE PRECISION,
    up_30d     INT,                    -- 最近 30 天上调家数
    down_30d   INT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, period, asof)
);
CREATE INDEX IF NOT EXISTS idx_eps_asof ON eps_estimates(asof DESC);
"""


def _f(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x != x else x          # NaN → None


def fetch_eps_trend(symbol: str, *, period: str = "+1y") -> dict | None:
    """取一只票的前瞻 EPS 修正轨迹。取不到返回 None（不写半行）。"""
    import yfinance as yf

    tk = yf.Ticker(symbol)
    try:
        trend = tk.eps_trend
        if trend is None or trend.empty or period not in trend.index:
            return None
        row = trend.loc[period]
    except Exception:                     # noqa: BLE001 — 单只失败不该中断整轮
        return None
    out = {
        "current": _f(row.get("current")),
        "d7": _f(row.get("7daysAgo")), "d30": _f(row.get("30daysAgo")),
        "d60": _f(row.get("60daysAgo")), "d90": _f(row.get("90daysAgo")),
        "up_30d": None, "down_30d": None,
    }
    if out["current"] is None:
        return None
    try:
        rev = tk.eps_revisions
        if rev is not None and not rev.empty and period in rev.index:
            r = rev.loc[period]
            up, down = _f(r.get("upLast30days")), _f(r.get("downLast30days"))
            out["up_30d"] = int(up) if up is not None else None
            out["down_30d"] = int(down) if down is not None else None
    except Exception:                     # noqa: BLE001 — 修正家数是加分项，缺了不影响主序列
        pass
    return out


def tracked_symbols(pool) -> list[str]:
    """知识库里被判断过、且是个股的标的——ETF/指数/商品没有卖方一致预期。"""
    from .prices import SYMBOL_MAP

    with pool.connection() as conn:
        rows = conn.execute("""
            SELECT DISTINCT u.payload->>'asset_symbol' AS sym
            FROM knowledge_units u
            WHERE u.kind='claim' AND u.payload->>'asset_symbol' IS NOT NULL
              AND EXISTS (SELECT 1 FROM extraction_runs r
                          WHERE r.id=u.run_id AND r.status='active')
        """).fetchall()
    out = []
    for r in rows:
        s = r["sym"]
        if not s or s not in SYMBOL_MAP:
            continue
        ticker = SYMBOL_MAP[s][0]
        if ticker.startswith("^") or "=" in ticker:      # 指数/期货/汇率
            continue
        out.append(s)
    return sorted(out)


def refresh(pool, *, symbols: list[str] | None = None, period: str = "+1y") -> dict:
    from .prices import SYMBOL_MAP

    with pool.connection() as conn:
        conn.execute(_SCHEMA)
    syms = symbols if symbols is not None else tracked_symbols(pool)
    today = dt.date.today()
    stat = {"tried": len(syms), "stored": 0, "skipped": 0}
    for s in syms:
        data = fetch_eps_trend(SYMBOL_MAP[s][0], period=period)
        if data is None:
            stat["skipped"] += 1
            continue
        with pool.connection() as conn:
            conn.execute("""
                INSERT INTO eps_estimates(symbol, period, asof, current, d7, d30, d60, d90,
                                          up_30d, down_30d)
                VALUES (%(s)s,%(p)s,%(a)s,%(current)s,%(d7)s,%(d30)s,%(d60)s,%(d90)s,
                        %(up_30d)s,%(down_30d)s)
                ON CONFLICT (symbol, period, asof) DO UPDATE SET
                  current=EXCLUDED.current, d7=EXCLUDED.d7, d30=EXCLUDED.d30,
                  d60=EXCLUDED.d60, d90=EXCLUDED.d90,
                  up_30d=EXCLUDED.up_30d, down_30d=EXCLUDED.down_30d,
                  fetched_at=now()
            """, {"s": s, "p": period, "a": today, **data})
        stat["stored"] += 1
    return stat


def revision_screen(pool, *, period: str = "+1y") -> list[dict]:
    """最新一期的修正筛：按 90 天修正幅度排序，负的排前面。

    node 342 的应对表就按这个分组——90 天修正为负的那组优先设止损。
    """
    with pool.connection() as conn:
        conn.execute(_SCHEMA)
        return conn.execute("""
            SELECT DISTINCT ON (symbol)
              symbol, asof, current, d30, d90, up_30d, down_30d,
              CASE WHEN d90 > 0 THEN round((current/d90 - 1)::numeric * 100, 1) END AS chg_90d_pct,
              CASE WHEN d30 > 0 THEN round((current/d30 - 1)::numeric * 100, 1) END AS chg_30d_pct
            FROM eps_estimates WHERE period=%s
            ORDER BY symbol, asof DESC
        """, (period,)).fetchall()


def main() -> None:
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        if "--screen" in sys.argv:
            rows = sorted(revision_screen(pool), key=lambda r: (r["chg_90d_pct"] is None,
                                                               r["chg_90d_pct"] or 0))
            print(f"{'标的':8}{'前瞻EPS':>10}{'90天':>9}{'30天':>9}{'上调':>6}{'下调':>6}")
            for r in rows:
                f = lambda v: f"{v:+.1f}%" if v is not None else "   —"
                print(f"{r['symbol']:8}{r['current']:>10.2f}{f(r['chg_90d_pct']):>9}"
                      f"{f(r['chg_30d_pct']):>9}{str(r['up_30d'] or '—'):>6}{str(r['down_30d'] or '—'):>6}")
            return
        st = refresh(pool)
        print(f"盈利预期修正：尝试 {st['tried']}，入库 {st['stored']}，无覆盖跳过 {st['skipped']}")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
