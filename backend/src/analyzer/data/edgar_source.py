"""SEC EDGAR 源（无 key，需 User-Agent）——取财报备案日，研究回填用。

earnings 事件用 10-Q/10-K 的**备案日**（filingDate）作 PIT 干净的事件时点（公开时刻）。
真正的盈利新闻稿通常在备案前 0–几天，但 PEAD 漂移按数周计、且备案后进场严格无未来函数，可接受。
ticker→CIK 走官方 company_tickers.json。best-effort 失败返回 []/{}。
"""

from __future__ import annotations

from ._http import get_json

_SUB = "https://data.sec.gov/submissions/"
_TICKERS = "https://www.sec.gov/files/company_tickers.json"
_UA = {"User-Agent": "fanisl-research/1.0 (research contact: fanisl@local)"}
_EARN_FORMS = {"10-Q", "10-K"}


def ticker_cik_map() -> dict[str, str]:
    """全市场 ticker → 10 位 CIK 字符串。"""
    try:
        d = get_json("EDGAR", _TICKERS, headers=_UA, timeout=30.0)
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for v in (d.values() if isinstance(d, dict) else []):
        t, cik = v.get("ticker"), v.get("cik_str")
        if t and cik is not None:
            out[t.upper()] = str(cik).zfill(10)
    return out


def _dates_from_block(block: dict) -> list[str]:
    forms = block.get("form") or []
    dates = block.get("filingDate") or []
    return [dt for f, dt in zip(forms, dates) if f in _EARN_FORMS]


def fetch_filing_dates(cik: str) -> list[str]:
    """某 CIK 的全部 10-Q/10-K 备案日（升序，YYYY-MM-DD）。含 recent + 更早的 files 分块。"""
    try:
        d = get_json("EDGAR", f"{_SUB}CIK{cik}.json", headers=_UA, timeout=30.0)
    except Exception:  # noqa: BLE001
        return []
    filings = d.get("filings") or {}
    dates = _dates_from_block(filings.get("recent") or {})
    for f in (filings.get("files") or []):
        name = f.get("name")
        if not name:
            continue
        try:
            older = get_json("EDGAR", f"{_SUB}{name}", headers=_UA, timeout=30.0)
            dates += _dates_from_block(older)
        except Exception:  # noqa: BLE001
            continue
    return sorted(set(dates))
