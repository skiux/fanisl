"""回填 WTI 小时线（OANDA WTICO_USD CFD mid，2008+），供 H19（EIA 盘中事件研究）。

- ts = bar **收盘**时刻（fetch_ohlcv_history 已做 open+1h 偏移，值已知的时刻，B-1 教训）。
- 写 metric='price_1h'（**不与** FRED 日线 metric='price' 混存——两源两粒度分开，
  防混合密度伪象，Phase 2 审计教训）。
- 跑：`python -m analyzer.research.backfill_wti_1h`（幂等，可重跑续填）。
"""

from __future__ import annotations

from ..config import get_settings
from ..data.oanda_source import OANDASource
from ..db import make_pool
from ..marketstore import MarketStore

SYMBOL = "CL"
INSTRUMENT = "WTICO_USD"
METRIC = "price_1h"
SINCE = "2008-01-01T00:00:00Z"   # 实测 OANDA H1 可达 2008-01


def main() -> None:
    s = get_settings()
    oanda = OANDASource(s.oanda_api_token or "", practice=getattr(s, "oanda_practice", True))
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        bars = oanda.fetch_ohlcv_history(INSTRUMENT, "1h", SINCE)
        rows = [("symbol", SYMBOL, METRIC, b["ts_close"], b["close"]) for b in bars]
        n = store.write_history(rows)
        span = f"{bars[0]['ts_close'][:13]}→{bars[-1]['ts_close'][:13]}" if bars else "-"
        print(f"  {SYMBOL} {METRIC}: {len(bars)} 根 H1 → 写入 {n} 行 [{span}]")
        if len(bars) == 0:
            print("  0 行：数据源异常，检查 OANDA token/instrument。")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
