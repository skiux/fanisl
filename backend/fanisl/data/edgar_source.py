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


def _rows_from_block(block: dict) -> list[tuple[str, str, str]]:
    """(form, filingDate, items) 三元组。items 为 8-K 的事项列表（如 '2.02,9.01'）。"""
    forms = block.get("form") or []
    dates = block.get("filingDate") or []
    items = block.get("items") or [""] * len(forms)
    return list(zip(forms, dates, items))


def _all_rows(cik: str) -> list[tuple[str, str, str]]:
    """recent + 更早 files 分块合并的全部 (form, date, items)。一次网络往返集合，供多个筛选复用。"""
    try:
        d = get_json("EDGAR", f"{_SUB}CIK{cik}.json", headers=_UA, timeout=30.0)
    except Exception:  # noqa: BLE001
        return []
    filings = d.get("filings") or {}
    rows = _rows_from_block(filings.get("recent") or {})
    for f in (filings.get("files") or []):
        name = f.get("name")
        if not name:
            continue
        try:
            rows += _rows_from_block(get_json("EDGAR", f"{_SUB}{name}", headers=_UA, timeout=30.0))
        except Exception:  # noqa: BLE001
            continue
    return rows


def fetch_filing_dates(cik: str) -> list[str]:
    """全部 10-Q/10-K 备案日（升序）。"""
    return sorted({dt for f, dt, _ in _all_rows(cik) if f in _EARN_FORMS})


def fetch_8k_earnings_dates(cik: str) -> list[str]:
    """8-K **Item 2.02（业绩发布）** 的备案日（升序）= 精确盈利公告日。"""
    return sorted({dt for f, dt, it in _all_rows(cik) if f == "8-K" and "2.02" in (it or "")})


_CONCEPT = "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json"
_EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]


def _days(start: str, end: str) -> int | None:
    from datetime import date
    try:
        return (date.fromisoformat(end) - date.fromisoformat(start)).days
    except (TypeError, ValueError):
        return None


def fetch_eps_quarterly(cik: str) -> list[tuple[str, float]]:
    """季度摊薄 EPS 历史 [(period_end, eps)] 升序（XBRL 原始财报，免费深到 ~2009）。

    取 fp∈{Q1,Q2,Q3} 的 3 个月期 EPS；同一 (fy,fp) 取**最早 filed**（原始申报、非重述）。
    供 H13 构造季节性 SUE（当季 vs ~1 年前同季）。best-effort 返回 []。
    """
    data = None
    for tag in _EPS_TAGS:
        try:
            data = get_json("EDGAR", _CONCEPT.format(cik=cik, tag=tag), headers=_UA, timeout=30.0)
            if data.get("units"):
                break
        except Exception:  # noqa: BLE001
            data = None
    if not data:
        return []
    facts = (data.get("units") or {}).get("USD/shares") or []
    best: dict[tuple, dict] = {}   # (fy,fp) -> 最早 filed 的 fact
    for f in facts:
        fp = f.get("fp")
        if fp not in ("Q1", "Q2", "Q3"):
            continue
        d = _days(f.get("start"), f.get("end"))
        if d is None or d > 100 or f.get("val") is None or not f.get("end"):
            continue
        key = (f.get("fy"), fp)
        cur = best.get(key)
        if cur is None or (f.get("filed") or "9") < (cur.get("filed") or "9"):
            best[key] = f
    out = [(f["end"], float(f["val"])) for f in best.values()]
    return sorted(out)
