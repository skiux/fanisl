"""回填逐小时爆仓流（多/空 USD）到行情库，供 H3（爆仓级联→反转）回测。

数据源 Coinalyze（聚合 30+ 所，免费档 1hour 可回看 ~180 天）。写入 metric_samples 的
liq_long_1h / liq_short_1h / liq_total_1h（**逐小时流量**，区别于现有 liq_*_24h 的 24h 滚动快照）。
这些是研究用历史，不进 metrics.py 实时目录（实时快照产不出逐小时流量，避免目录里挂"会变陈旧"的指标）。

跑：`python -m analyzer.research.backfill_liq`（幂等，可重跑）。
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
        raise SystemExit("无 COINALYZE_API_KEY，无法回填爆仓历史")
    src = CoinalyzeSource(s.coinalyze_api_key)
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        total = 0
        for sym in UNIVERSE:
            base = sym.split("/")[0]
            hist = src.fetch_liquidation_history(base, days=DAYS)
            rows: list[tuple] = []
            for ts, lo, sh in hist:
                rows.append(("symbol", sym, "liq_long_1h", ts, lo))
                rows.append(("symbol", sym, "liq_short_1h", ts, sh))
                rows.append(("symbol", sym, "liq_total_1h", ts, lo + sh))
            n = store.write_history(rows)
            total += n
            span = f"{hist[0][0].date()}→{hist[-1][0].date()}" if hist else "-"
            print(f"  {sym:<10} {len(hist):>5} 桶 → {n:>6} 行  {span}", flush=True)
            time.sleep(3)  # 免费档 40/min，标的间留空避免再触发限流
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
