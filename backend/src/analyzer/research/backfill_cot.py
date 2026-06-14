"""回填 COT 持仓（CFTC）+ 金银油长历史价，供 H8（COT 极值反转）回测。

COT：CftcSource 取 disaggregated 周度历史，**入库 ts 偏移到发布时点**（report 周二 + 3 天 = 周五，
取 21:00 UTC，CFTC 周五 15:30 ET 发布之后）——严格无未来函数。写 metric_samples：
cot_mm_long/short/net（管理基金=投机）、cot_comm_net（prod_merc+swap=商业套保）、cot_oi。

价格（前向收益用，要长历史多 regime）：WTI 走 FRED DCOILWTICO（1986+），金银走 OANDA 日线
count=5000（~2008+）。统一写成 metric='price'，喂研究 harness（pit.load_series）。

跑：`python -m analyzer.research.backfill_cot`（幂等，可重跑）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..config import get_settings
from ..data.cftc_source import CONTRACT_CODES, CftcSource
from ..data.fred_source import FREDSource
from ..data.oanda_source import OANDASource
from ..db import make_pool
from ..marketstore import MarketStore

UNIVERSE = ["XAU/USD", "XAG/USD", "CL"]
# 价源：金银 OANDA(日线 count=5000 ~2008+)，WTI FRED(1986+)
OANDA_SYM = {"XAU/USD": "XAU_USD", "XAG/USD": "XAG_USD"}
FRED_SYM = {"CL": "DCOILWTICO"}
PUB_LAG_DAYS = 3          # 周二 report → 周五发布
PUB_HOUR_UTC = 21         # 发布后（15:30 ET ≈ 19:30-20:30 UTC，取 21:00 保守）


def _publish_ts(report_date: str) -> str:
    """周二 as-of 日 → 周五发布时刻（UTC ISO）。无未来函数的关键一步。"""
    d = datetime.strptime(report_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return (d + timedelta(days=PUB_LAG_DAYS)).replace(hour=PUB_HOUR_UTC).isoformat()


def _cot_rows(symbol: str, hist: list[dict]) -> list[tuple]:
    rows: list[tuple] = []
    for h in hist:
        ts = _publish_ts(h["report_date"])
        mm_net = h["mm_long"] - h["mm_short"]
        comm_net = (h["prod_merc_long"] + h["swap_long"]) - (h["prod_merc_short"] + h["swap_short"])
        rows += [
            ("symbol", symbol, "cot_mm_long", ts, h["mm_long"]),
            ("symbol", symbol, "cot_mm_short", ts, h["mm_short"]),
            ("symbol", symbol, "cot_mm_net", ts, mm_net),
            ("symbol", symbol, "cot_comm_net", ts, comm_net),
            ("symbol", symbol, "cot_oi", ts, h["oi"]),
        ]
    return rows


def _price_rows(symbol: str, oanda: OANDASource, fred: FREDSource) -> tuple[list[tuple], str]:
    rows: list[tuple] = []
    if symbol in OANDA_SYM:
        df = oanda.fetch_ohlcv(OANDA_SYM[symbol], "1d", 5000)
        for t, c in zip(df["ts"], df["close"]):
            rows.append(("symbol", symbol, "price", t.isoformat(), float(c)))
    elif symbol in FRED_SYM:
        for o in fred.fetch_series_history(FRED_SYM[symbol]):
            rows.append(("symbol", symbol, "price", o["ts"], o["value"]))
    span = f"{rows[0][3][:10]}→{rows[-1][3][:10]}" if rows else "-"
    return rows, span


def main() -> None:
    s = get_settings()
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    cftc = CftcSource()
    oanda = OANDASource(getattr(s, "oanda_api_token", "") or "",
                        practice=getattr(s, "oanda_practice", True))
    fred = FREDSource(getattr(s, "fred_api_key", "") or "")
    try:
        total = 0
        for sym in UNIVERSE:
            hist = cftc.fetch_cot_history(CONTRACT_CODES[sym])
            crows = _cot_rows(sym, hist)
            n_cot = store.write_history(crows)
            cot_span = f"{hist[0]['report_date']}→{hist[-1]['report_date']}" if hist else "-"
            prows, p_span = _price_rows(sym, oanda, fred)
            n_px = store.write_history(prows)
            total += n_cot + n_px
            print(f"  {sym:<9} COT {len(hist):>4} 周 → {n_cot:>5} 行 [{cot_span}]   "
                  f"price {len(prows):>5} → {n_px:>5} 行 [{p_span}]", flush=True)
        print(f"合计写入 {total} 行")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
