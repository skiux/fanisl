"""回填 WTI M1 事件窗（OANDA，仅 EIA 发布前后），供 H22（过冲回归）。

每个 EIA 事件取 [调整后发布−30min, 发布+8h] 的 M1 mid（单页），写 metric='price_1m'
（**稀疏事件窗序列**，只用于事件研究，不作连续序列使用；ts=bar 收盘）。
跑：`python -m analyzer.research.backfill_wti_1m_events`（幂等，可重跑续填）。
"""

from __future__ import annotations

import time
from datetime import timedelta

from ..config import get_settings
from ..data.base import DataSourceError
from ..data.oanda_source import OANDASource
from ..db import make_pool
from ..marketstore import MarketStore
from . import pit
from .h18 import build_events
from .h19 import adjusted_publish

SYMBOL = "CL"
INSTRUMENT = "WTICO_USD"
METRIC = "price_1m"
PRE = timedelta(minutes=30)
POST = timedelta(hours=8)
SLEEP_S = 0.15


def main() -> None:
    s = get_settings()
    oanda = OANDASource(s.oanda_api_token or "", practice=getattr(s, "oanda_practice", True))
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        events = build_events(pit.load_series(pool, SYMBOL, "eia_crude_stocks"))
        total = skipped = 0
        for i, (ts, _p, _d) in enumerate(events, 1):
            adj = adjusted_publish(ts)
            rows = []
            for attempt in range(3):
                try:
                    bars = oanda.fetch_window(
                        INSTRUMENT, "M1", (adj - PRE).isoformat(), (adj + POST).isoformat()
                    )
                    rows = [("symbol", SYMBOL, METRIC, b["ts_close"], b["close"]) for b in bars]
                    break
                except DataSourceError:
                    if attempt == 2:
                        skipped += 1
                    else:
                        time.sleep(5.0)
            total += store.write_history(rows)
            if i % 100 == 0:
                print(f"  {i}/{len(events)} 事件，累计 {total} 行", flush=True)
            time.sleep(SLEEP_S)
        print(f"完成：{len(events)} 事件 → {total} 行 M1（失败跳过 {skipped}）", flush=True)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
