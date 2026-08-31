"""公司资料源：Polygon 参考数据 + Finnhub 画像与估值指标。

**两个源分工，不是二选一**（2026-08-30 实测 NVDA 定的口径）：
- Polygon `/v3/reference/tickers/{t}`：名称、业务描述、SIC 行业、市值（绝对美元）、
  雇员数、**CIK**（顺带把 EDGAR 的入口带出来，不必再拉一次 ticker→CIK 全表）、
  上市日、主交易所。免费档 **5 次/分**，调用方必须自己限速。
- Finnhub `/stock/profile2`：logo、IPO 日、流通股本、交易所全名、国家/币种。免费档 60 次/分。
- Finnhub `/stock/metric?metric=all`：133 个字段，这里只挑 14 个稳定且看得懂的
  （估值/利润率/增长/波动），全量存 JSONB 会把口径不明的字段混进来。

覆盖范围只有**个股与 ETF**：指数、金属、原油、利率这些没有"公司"，两个源都不收录，
调用方按 asset_class 决定要不要问，别拿 404 当故障。best-effort，失败返回 None。
"""

from __future__ import annotations

from ._http import get_json

_POLYGON = "https://api.polygon.io/v3/reference/tickers/"
_FINNHUB_PROFILE = "https://finnhub.io/api/v1/stock/profile2"
_FINNHUB_METRIC = "https://finnhub.io/api/v1/stock/metric"

# Finnhub metric 里保留的字段 → 我方字段名。挑选原则：口径清楚、跨标的可比、不随财报口径漂。
_METRICS = {
    "peTTM": "pe_ttm",
    "psTTM": "ps_ttm",
    "pbQuarterly": "pb",
    "epsTTM": "eps_ttm",
    "grossMarginTTM": "gross_margin",
    "operatingMarginTTM": "operating_margin",
    "netProfitMarginTTM": "net_margin",
    "revenueGrowthTTMYoy": "revenue_growth_yoy",
    "epsGrowthTTMYoy": "eps_growth_yoy",
    "roeTTM": "roe",
    "beta": "beta",
    "52WeekHigh": "high_52w",
    "52WeekLow": "low_52w",
    "currentDividendYieldTTM": "dividend_yield",
}


def fetch_polygon_reference(ticker: str, api_key: str) -> dict | None:
    if not api_key:
        return None
    try:
        data = get_json("Polygon", _POLYGON + ticker, params={"apiKey": api_key},
                        retry_statuses=(429,), timeout=25.0)
    except Exception:  # noqa: BLE001 — 未收录的标的会 404，属常态
        return None
    row = (data or {}).get("results")
    if not isinstance(row, dict) or not row.get("ticker"):
        return None
    address = row.get("address") or {}
    return {
        "name": row.get("name"),
        "description": row.get("description"),
        "industry": row.get("sic_description"),
        "exchange": row.get("primary_exchange"),
        "currency": (row.get("currency_name") or "").upper() or None,
        "cik": row.get("cik"),
        "homepage": row.get("homepage_url"),
        "listed_on": row.get("list_date"),
        "employees": row.get("total_employees"),
        "market_cap": row.get("market_cap"),
        "shares_out": row.get("weighted_shares_outstanding") or row.get("share_class_shares_outstanding"),
        "locale": row.get("locale"),
        "city": address.get("city"),
    }


def fetch_finnhub_profile(ticker: str, api_key: str) -> dict | None:
    if not api_key:
        return None
    try:
        row = get_json("Finnhub", _FINNHUB_PROFILE,
                       params={"symbol": ticker, "token": api_key}, timeout=25.0)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(row, dict) or not row.get("ticker"):
        return None
    return {
        "name": row.get("name"),
        "industry": row.get("finnhubIndustry"),
        "exchange": row.get("exchange"),
        "country": row.get("country"),
        "currency": row.get("currency"),
        "homepage": row.get("weburl"),
        "logo": row.get("logo") or None,
        "ipo": row.get("ipo") or None,
        # profile2 的市值与股本单位是**百万**，与 Polygon 的绝对值不同——换算在这里做完，
        # 别把两种单位混进同一列（2026-08-30 实测 NVDA：5 235 483.9 百万 = 5.24 万亿）。
        "market_cap": (row.get("marketCapitalization") or 0) * 1e6 or None,
        "shares_out": (row.get("shareOutstanding") or 0) * 1e6 or None,
    }


def fetch_finnhub_metrics(ticker: str, api_key: str) -> dict | None:
    if not api_key:
        return None
    try:
        data = get_json("Finnhub", _FINNHUB_METRIC,
                        params={"symbol": ticker, "metric": "all", "token": api_key}, timeout=25.0)
    except Exception:  # noqa: BLE001
        return None
    raw = (data or {}).get("metric")
    if not isinstance(raw, dict):
        return None
    out = {}
    for source_key, our_key in _METRICS.items():
        value = raw.get(source_key)
        if isinstance(value, (int, float)):
            out[our_key] = float(value)
    return out or None


def build_profile(ticker: str, *, polygon_key: str, finnhub_key: str) -> dict | None:
    """合并两个源。**逐字段记来源**，将来某个字段看着不对时能直接查是谁给的。"""
    polygon = fetch_polygon_reference(ticker, polygon_key)
    finnhub = fetch_finnhub_profile(ticker, finnhub_key)
    if polygon is None and finnhub is None:
        return None
    fields = ("name", "description", "industry", "exchange", "country", "currency", "cik",
              "homepage", "logo", "listed_on", "employees", "market_cap", "shares_out")
    merged: dict = {}
    sources: dict = {}
    for field in fields:
        # Polygon 优先：它的口径是绝对值且带 CIK；Finnhub 补它没有的（logo/国家/IPO）。
        for label, row in (("polygon", polygon), ("finnhub", finnhub)):
            value = (row or {}).get(field)
            if value not in (None, "", 0):
                merged[field] = value
                sources[field] = label
                break
    if not merged.get("listed_on") and (finnhub or {}).get("ipo"):
        merged["listed_on"] = finnhub["ipo"]
        sources["listed_on"] = "finnhub"
    metrics = fetch_finnhub_metrics(ticker, finnhub_key)
    if metrics:
        merged["metrics"] = metrics
        sources["metrics"] = "finnhub"
    merged["sources"] = sources
    return merged
