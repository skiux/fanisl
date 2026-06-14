"""回填季度摊薄 EPS（SEC EDGAR XBRL，无 key），供 H13（SUE-based PEAD）构造季节性 SUE。

存 metric_samples 的 eps_q，**ts=period_end**（季度结束日；该 EPS 在公告日才真正已知，H13 按 8-K 公告日匹配
"最近已结束季度"来用，PIT 由 H13 的匹配逻辑保证）。只补 EPS；price/8-K 已由 backfill_equity 入库。

跑：`python -m analyzer.research.backfill_eps`（幂等）。
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from ..config import get_settings
from ..data import edgar_source
from ..db import make_pool
from ..marketstore import MarketStore
from .backfill_equity import EQUITY


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    store = MarketStore(pool)
    try:
        cik = edgar_source.ticker_cik_map()
        if not cik:
            raise SystemExit("EDGAR ticker→CIK 取失败")
        total = 0
        for sym in EQUITY:
            c = cik.get(sym)
            if not c:
                print(f"  {sym:<6} 无 CIK，跳过")
                continue
            eps = edgar_source.fetch_eps_quarterly(c)
            rows = []
            for end, val in eps:
                ts = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
                rows.append(("symbol", sym, "eps_q", ts, val))
            n = store.write_history(rows)
            total += n
            span = f"{eps[0][0]}→{eps[-1][0]}" if eps else "-"
            print(f"  {sym:<6} EPS {len(eps):>3} 季 → {n:>4} 行  [{span}]", flush=True)
            time.sleep(0.3)
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
