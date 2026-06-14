"""回填美股研究数据（无 key）：Yahoo 复权日线价 + SEC EDGAR 财报备案日，供 H9（PEAD）回测。

- price：Yahoo adjclose（复权，做股票前向收益必须）→ metric_samples 'price'，含 SPY 基准。
- 财报事件：EDGAR 10-Q/10-K 备案日 → 'earn_filing'=1.0，**ts=备案日 21:00 UTC**（美股收盘后，
  保证 first_after 取到次交易日进场，严格无未来函数）。

跑：`python -m analyzer.research.backfill_equity`（幂等，可重跑）。
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from ..config import get_settings
from ..data import edgar_source, yahoo_source
from ..db import make_pool
from ..marketstore import MarketStore

# 深历史、流动的大盘股篮子（~36，跨板块）；SPY 作市场基准（PEAD 用市场调整收益）。
# H12 横截面组合 PEAD 需要足够宽的 universe 来分散单股 idiosyncratic 方差（H11 的 ③ 命门）。
EQUITY = [
    "NVDA", "AAPL", "TSLA", "MSFT", "META", "AMZN", "GOOGL", "AVGO", "AMD", "MU",
    "QCOM", "TXN", "ORCL", "CSCO", "ADBE", "CRM", "NFLX", "INTC",
    "JPM", "BAC", "V", "MA", "GS", "WFC",
    "JNJ", "UNH", "LLY", "MRK", "ABBV", "PFE",
    "XOM", "CVX", "WMT", "PG", "KO", "HD", "MCD", "DIS", "CAT", "COST",
]
BENCH = "SPY"
FILING_HOUR_UTC = 21    # 美股收盘(~20:00 UTC)后，次日进场


def _price_rows(symbol: str) -> tuple[list[tuple], str]:
    px = yahoo_source.fetch_daily_adjclose(symbol)
    rows = [("symbol", symbol, "price", t.isoformat(), c) for t, c in px]
    span = f"{px[0][0].date()}→{px[-1][0].date()}" if px else "-"
    return rows, span


def _event_rows(symbol: str, dates: list[str], metric: str) -> list[tuple]:
    rows = []
    for d in dates:
        ts = datetime.strptime(d, "%Y-%m-%d").replace(hour=FILING_HOUR_UTC, tzinfo=timezone.utc)
        rows.append(("symbol", symbol, metric, ts.isoformat(), 1.0))
    return rows


def _earn_rows(symbol: str, cik: str) -> tuple[list[tuple], int, int]:
    """earn_filing = 10-Q/10-K 备案日；earn_8k = 8-K Item2.02 精确盈利公告日（供 H11）。"""
    f10 = edgar_source.fetch_filing_dates(cik)
    e8k = edgar_source.fetch_8k_earnings_dates(cik)
    rows = _event_rows(symbol, f10, "earn_filing") + _event_rows(symbol, e8k, "earn_8k")
    return rows, len(f10), len(e8k)


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    store = MarketStore(pool)
    try:
        cik = edgar_source.ticker_cik_map()
        if not cik:
            raise SystemExit("EDGAR ticker→CIK 取失败")
        total = 0
        for sym in [BENCH, *EQUITY]:
            prows, span = _price_rows(sym)
            n_px = store.write_history(prows)
            n_10, n_8k = 0, 0
            if sym != BENCH and cik.get(sym):
                erows, n_10, n_8k = _earn_rows(sym, cik[sym])
                store.write_history(erows)
            total += n_px + n_10 + n_8k
            print(f"  {sym:<6} price {len(prows):>5} 行 [{span}]   "
                  f"10Q/K {n_10:>3}  8-K(2.02) {n_8k:>3}", flush=True)
            time.sleep(0.5)   # 对 Yahoo/EDGAR 客气
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
