"""摄取健康度：各数据源最新到哪、近 24h 进了多少、有没有停摆。

跑在有库的机器上（服务器，或本地接了隧道时）：
  cd backend && PYTHONPATH=src .venv/bin/python tools/check_ingest.py
"""

import datetime as dt
import sys

from analyzer.config import get_settings
from analyzer.db import make_pool


def _q(pool, sql):
    with pool.connection() as c:
        return c.execute(sql).fetchall()


def _age(ts):
    if ts is None:
        return "无数据"
    if isinstance(ts, dt.date) and not isinstance(ts, dt.datetime):
        ts = dt.datetime.combine(ts, dt.time(), tzinfo=dt.timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=dt.timezone.utc)
    h = (dt.datetime.now(dt.timezone.utc) - ts).total_seconds() / 3600
    return f"{h:.1f}h 前" if h < 48 else f"{h/24:.1f}d 前"


def main() -> int:
    s = get_settings()
    mkt = make_pool(s.pg_conninfo)
    kno = make_pool(s.pg_knowledge_conninfo)
    try:
        print("采集调度（collection_runs）")
        for r in _q(mkt, """SELECT job, max(started_at) AS last, count(*) AS n,
                                   count(*) FILTER (WHERE ok=0) AS failed
                            FROM collection_runs WHERE started_at > now() - interval '24 hours'
                            GROUP BY job ORDER BY job"""):
            print(f"  {r['job']:12s} 近 24h {r['n']:4d} 次，失败 {r['failed']:4d}，"
                  f"最后一次 {_age(r['last'])}")

        print("\n行情时间序列（metric_samples）")
        for r in _q(mkt, """SELECT max(ts) AS last, count(*) AS n24,
                                   count(DISTINCT symbol) AS syms
                            FROM metric_samples WHERE ts > now() - interval '24 hours'"""):
            print(f"  近 24h {r['n24']} 条 / {r['syms']} 个标的，最新 {_age(r['last'])}")
        for r in _q(mkt, "SELECT count(*) AS total, min(ts)::date AS first FROM metric_samples"):
            print(f"  全量 {r['total']} 条，最早 {r['first']}")

        print("\n知识引擎行情（daily_bars）")
        for r in _q(kno, """SELECT max(ts)::date AS last, count(DISTINCT symbol) AS syms,
                                   count(*) AS n FROM daily_bars"""):
            print(f"  {r['syms']} 个符号 / {r['n']} 行，最新交易日 {r['last']}（{_age(r['last'])}）")
        stale = _q(kno, """SELECT symbol, max(ts)::date AS last FROM daily_bars GROUP BY symbol
                           HAVING max(ts) < (SELECT max(ts) FROM daily_bars) - interval '5 days'
                           ORDER BY 2 LIMIT 8""")
        print(f"  落后 5 天以上的符号：{len(stale)} 个" + (
            "" if not stale else "  " + ", ".join(f"{r['symbol']}({r['last']})" for r in stale)))

        print("\n盈利预期（eps_estimates）")
        for r in _q(kno, """SELECT count(DISTINCT asof) AS snaps, max(asof)::date AS last,
                                   count(DISTINCT symbol) AS syms FROM eps_estimates"""):
            print(f"  {r['snaps']} 个快照 / {r['syms']} 个符号，最新 {r['last']}（{_age(r['last'])}）")

        print("\n验证层（claim_scores）")
        for r in _q(kno, """SELECT max(created_at) AS last, count(*) AS total FROM claim_scores"""):
            print(f"  累计 {r['total']} 条判定，最后一次写入 {_age(r['last'])}")
        for r in _q(kno, """SELECT count(*) AS n FROM claim_scores
                            WHERE created_at > now() - interval '24 hours'"""):
            print(f"  近 24h 新增 {r['n']} 条")

        print("\nL0 语料（contents）")
        for r in _q(kno, """SELECT count(*) AS n, max(published_at)::date AS newest
                            FROM contents"""):
            print(f"  {r['n']} 期，最新发布日 {r['newest']}")
        for r in _q(kno, """SELECT status, count(*) AS n FROM contents
                            WHERE status <> 'extracted' GROUP BY status ORDER BY 1"""):
            hint = "（重复入库/被新版取代，正常）" if r["status"] == "superseded" else "（待提取）"
            print(f"  {r['status']}: {r['n']} 期 {hint}")
    finally:
        mkt.close(); kno.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
