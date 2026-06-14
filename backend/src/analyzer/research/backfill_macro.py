"""回填研究用宏观驱动序列（FRED，已配 key）。当前：10年期 TIPS 实际利率，供 H10（金↔实际利率）。

实际利率 = 黄金的机会成本（无息资产），是金价最强的宏观驱动之一。存 scope=global 的 real_rate_10y。
DXY(dxy_broad) 已由常规 backfill_global 入库；这里只补研究需要、常规目录没有的 real_rate_10y。

跑：`python -m analyzer.research.backfill_macro`（幂等）。
"""

from __future__ import annotations

from ..config import get_settings
from ..data.fred_source import FREDSource
from ..db import make_pool
from ..marketstore import GLOBAL, MarketStore

SERIES = [("DFII10", "real_rate_10y"), ("DFII5", "real_rate_5y")]


def main() -> None:
    s = get_settings()
    fred = FREDSource(s.fred_api_key or "")
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        total = 0
        for sid, metric in SERIES:
            hist = fred.fetch_series_history(sid)
            rows = [("global", GLOBAL, metric, o["ts"], o["value"]) for o in hist]
            n = store.write_history(rows)
            total += n
            span = f"{hist[0]['ts'][:10]}→{hist[-1]['ts'][:10]}" if hist else "-"
            print(f"  {metric:<14} {n:>5} 行 [{span}]", flush=True)
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
