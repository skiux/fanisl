"""回填深资金费历史（~5 年日线，Coinalyze）+ 深现货日线价（Binance spot），供 H17（趋势×定位闸门）。

- funding_rate_1d：日线收盘资金费（当日最后一次结算费率），**ts=桶收盘**（开盘+24h）。
  独立 metric，不混入实时采集的 funding_rate（那是 8h 快照语义）。fapi 已 451，Coinalyze 兼作冗余源。
- price：**Coinalyze 同符号（Binance 永续）日线收盘**，~5 年，**ts=K线收盘时刻**（杜绝"开盘戳装收盘值"
  的 lookahead——正是 screen.py 逮到的 bar 指标污染，此处从源头写对）。Binance spot/fapi 均已 451，
  Coinalyze 兼作价格冗余源；与资金费同一合约，匹配更干净。

跑：`python -m analyzer.research.backfill_funding_deep`（幂等，可重跑）。
"""

from __future__ import annotations

import time

from ..config import get_settings
from ..data.coinalyze_source import CoinalyzeSource
from ..db import make_pool
from ..marketstore import MarketStore

UNIVERSE = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ZEC/USDT",
    "AVAX/USDT", "LINK/USDT", "NEAR/USDT", "ATOM/USDT", "FIL/USDT", "APT/USDT",
    "ARB/USDT", "OP/USDT", "INJ/USDT", "SUI/USDT", "SEI/USDT", "TIA/USDT",
    "RUNE/USDT", "AAVE/USDT", "LDO/USDT", "DOGE/USDT", "DOT/USDT", "LTC/USDT",
]
def main() -> None:
    s = get_settings()
    if not s.coinalyze_api_key:
        raise SystemExit("无 COINALYZE_API_KEY")
    src = CoinalyzeSource(s.coinalyze_api_key)
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        total = 0
        for sym in UNIVERSE:
            base = sym.split("/")[0]
            fr = src.fetch_funding_history_daily(base)
            frows = [("symbol", sym, "funding_rate_1d", ts.isoformat(), v) for ts, v in fr]
            px = src.fetch_price_history_daily(base)
            prows = [("symbol", sym, "price", ts.isoformat(), v) for ts, v in px]
            n = store.write_history(frows) + store.write_history(prows)
            total += n
            fspan = f"{fr[0][0].date()}→{fr[-1][0].date()}" if fr else "-"
            pspan = f"{px[0][0].date()}→{px[-1][0].date()}" if px else "-"
            print(f"  {sym:<11} funding_1d {len(fr):>5} [{fspan}]   price_1d {len(px):>5} [{pspan}]", flush=True)
            time.sleep(4)  # Coinalyze 免费档 40/min,每标的 2 次调用
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
