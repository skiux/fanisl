"""K4 价格层：claim 评分所需的日线 OHLC（独立小表 daily_bars，存 fanisl_knowledge）。

来源：yfinance（美股/ETF/指数/期货/汇率/加密）+ FRED 公开 CSV（政策利率）。
符号用 claim 的 asset_symbol 口径，映射与代理口径见 SYMBOL_MAP（期货代理现货者已注明，
基差对宽区间判定影响可忽略；US10Y/US30Y 为 ^TNX/^TYX ÷10）。

用法：python -m analyzer.knowledge.prices [--since 2026-04-15]（幂等 upsert）
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import sys

import httpx

from ..config import get_settings
from ..db import make_pool

# asset_symbol → (yfinance ticker, 倍率, 口径备注)
SYMBOL_MAP: dict[str, tuple[str, float, str]] = {
    "XAUUSD": ("GC=F", 1.0, "COMEX 金期货近月代理现货"),
    "XAGUSD": ("SI=F", 1.0, "COMEX 银期货近月代理现货"),
    "WTI": ("CL=F", 1.0, "NYMEX WTI 期货近月"),
    "NDX": ("^NDX", 1.0, ""), "SPX": ("^GSPC", 1.0, ""), "DJI": ("^DJI", 1.0, ""),
    "SOX": ("^SOX", 1.0, "费城半导体指数"), "KOSPI": ("^KS11", 1.0, ""),
    "DXY": ("DX-Y.NYB", 1.0, "ICE 美元指数"),
    "AUDJPY": ("AUDJPY=X", 1.0, ""),
    "US10Y": ("^TNX", 1.0, "收益率%（yfinance 直读口径，实测 2026-05 为 4.48）"),
    "US30Y": ("^TYX", 1.0, "收益率%（直读口径）"),
    "BTCUSDT": ("BTC-USD", 1.0, "现货指数代理"),
    **{t: (t, 1.0, "") for t in [
        "SOXX", "IGV", "MAGS", "MU", "TSLA", "TEAM", "SNDK", "NVDA", "MSFT", "PCOR",
        "CRCL", "CRM", "CRWV", "DDOG", "META", "MRVL", "PLTR", "QCOM", "SPCX", "UFOX",
        "XLV", "OKTA", "NOW", "SNOW", "TWLO",
        # 2026-08 新语料带入（c19-21：微软/亚马逊成长空间、工业 vs 公用事业分散配置）
        "AMZN", "GOOG", "XLI", "XLU", "RSP", "AAPL", "MOAT", "SEMI", "ITA", "DRAM", "SMH", "AAXJ",
        # 2026-08 新信源投资TALK君带入（c30-39：公用事业防守配置、英特尔增发、软件/支付/存储）
        "VST", "CEG", "NEE", "INTC", "AVGO", "AMD", "APP", "COIN", "V", "MA", "PYPL", "SHOP",
        "UBER", "DIS", "NET", "TSM", "ASML", "GOOGL", "ORCL", "HOOD", "BE", "NOK", "FIG",
        "CBRS", "NBIS", "TLT", "KBWB", "UNH", "NFLX", "GE", "ISRG"]},
    "VIX": ("^VIX", 1.0, "CBOE 波动率指数"),
    "GSCI": ("^SPGSCI", 1.0, "标普高盛商品指数（能源权重约 40%）"),
}
# 已核不可用（勿反复试）：恒生科技指数 —— ^HSTECH 无数据，HSTECH.HK 一个月仅 1 根有效，
# 3033.HK（ETF）价位口径与指数点位不同、无法验"突破 4850"类判断 → 恒科 claim 只能 priceable=false。
FRED_SERIES = {"DFEDTARU": "联邦基金目标区间上限%",
               "T10Y2Y": "10年期减2年期国债利差%（牛陡/熊陡/倒挂的经典口径）"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_bars (
    symbol TEXT NOT NULL,
    ts     DATE NOT NULL,
    open   DOUBLE PRECISION, high DOUBLE PRECISION, low DOUBLE PRECISION,
    close  DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (symbol, ts)
);
"""


class PriceStore:
    def __init__(self, pool) -> None:
        self.pool = pool
        with pool.connection() as conn:
            conn.execute(_SCHEMA)

    def upsert(self, symbol: str, rows: list[tuple], source: str) -> int:
        """rows: (ts, open, high, low, close)。返回写入行数。"""
        with self.pool.connection() as conn:
            for r in rows:
                conn.execute(
                    "INSERT INTO daily_bars(symbol, ts, open, high, low, close, source) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (symbol, ts) DO UPDATE "
                    "SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, "
                    "close=EXCLUDED.close, source=EXCLUDED.source",
                    (symbol, *r, source))
        return len(rows)

    def close_on_or_before(self, symbol: str, d: dt.date) -> tuple[dt.date, float] | None:
        with self.pool.connection() as conn:
            row = conn.execute(
                "SELECT ts, close FROM daily_bars WHERE symbol=%s AND ts<=%s "
                "ORDER BY ts DESC LIMIT 1", (symbol, d)).fetchone()
        return (row["ts"], row["close"]) if row else None

    def window(self, symbol: str, start: dt.date, end: dt.date) -> list[dict]:
        """[start, end] 闭区间日线，按时间升序。"""
        with self.pool.connection() as conn:
            return conn.execute(
                "SELECT ts, open, high, low, close FROM daily_bars "
                "WHERE symbol=%s AND ts>=%s AND ts<=%s ORDER BY ts", (symbol, start, end),
            ).fetchall()

    def coverage(self) -> list[dict]:
        with self.pool.connection() as conn:
            return conn.execute(
                "SELECT symbol, count(*) AS n, min(ts) AS first, max(ts) AS last "
                "FROM daily_bars GROUP BY symbol ORDER BY symbol").fetchall()


def fetch_yf(symbol: str, since: dt.date) -> list[tuple]:
    import yfinance as yf
    ticker, scale, _ = SYMBOL_MAP[symbol]
    df = yf.Ticker(ticker).history(start=str(since), auto_adjust=False, actions=False)
    rows = []
    for idx, r in df.iterrows():
        if r.isna()["Close"]:
            continue
        rows.append((idx.date(), float(r["Open"]) * scale, float(r["High"]) * scale,
                     float(r["Low"]) * scale, float(r["Close"]) * scale))
    return rows


def fetch_fred(series: str, since: dt.date) -> list[tuple]:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}&cosd={since}"
    text = httpx.get(url, timeout=60.0, follow_redirects=True).text
    rows = []
    for rec in csv.DictReader(io.StringIO(text)):
        v = rec.get(series) or rec.get(series.upper()) or ""
        if v in ("", "."):
            continue
        d = dt.date.fromisoformat(rec["observation_date"] if "observation_date" in rec else rec["DATE"])
        rows.append((d, float(v), float(v), float(v), float(v)))
    return rows


def refresh(pool, *, since: dt.date) -> None:
    ps = PriceStore(pool)
    for sym in SYMBOL_MAP:
        try:
            n = ps.upsert(sym, fetch_yf(sym, since), f"yfinance:{SYMBOL_MAP[sym][0]}")
            print(f"  {sym:8s} {n} bars", flush=True)
        except Exception as e:  # noqa: BLE001 — 单符号失败不阻断
            print(f"  {sym:8s} FAIL {str(e)[:70]}", flush=True)
    for series in FRED_SERIES:
        try:
            n = ps.upsert(series, fetch_fred(series, since), f"fred:{series}")
            print(f"  {series:8s} {n} obs", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"  {series:8s} FAIL {str(e)[:70]}", flush=True)


def main() -> None:
    since = dt.date.fromisoformat(sys.argv[sys.argv.index("--since") + 1]) \
        if "--since" in sys.argv else dt.date(2026, 4, 15)
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        refresh(pool, since=since)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
