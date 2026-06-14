"""回填逐小时持仓量（OI，USD）到行情库，供 H4（级联 × OI 去杠杆）回测。

数据源 Coinalyze（聚合 30+ 所，免费档 1hour 可回看 ~180 天）。写入 metric_samples 的
oi_usd_1h（**逐小时聚合 OI 快照**，区别于现有 open_interest_usd 的实时快照、仅 ~24d）。
研究用历史，不进 metrics.py 实时目录。

跑：`python -m analyzer.research.backfill_oi`（幂等，可重跑）。
"""

from __future__ import annotations

import time

from ..config import get_settings
from ..data.coinalyze_source import CoinalyzeSource
from ..db import make_pool
from ..marketstore import MarketStore

UNIVERSE = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT"]
DAYS = 180


def main() -> None:
    s = get_settings()
    if not s.coinalyze_api_key:
        raise SystemExit("无 COINALYZE_API_KEY，无法回填 OI 历史")
    src = CoinalyzeSource(s.coinalyze_api_key)
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        total = 0
        for sym in UNIVERSE:
            base = sym.split("/")[0]
            hist = src.fetch_oi_history(base, days=DAYS)
            rows = [("symbol", sym, "oi_usd_1h", ts, oi) for ts, oi in hist]
            n = store.write_history(rows)
            total += n
            span = f"{hist[0][0].date()}→{hist[-1][0].date()}" if hist else "-"
            print(f"  {sym:<10} {len(hist):>5} 桶 → {n:>6} 行  {span}", flush=True)
            time.sleep(3)  # 免费档 40/min，标的间留空避免限流
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
