"""Deribit 期权数据源（公开 API，无需 key）——币圈期权主场。

一把 get_book_summary_by_currency 拿到该币全部期权合约的 OI/IV/标的价，自己聚合出：
看跌看涨未平仓比(PCR)、最大痛点(max pain)、平值 IV、IV skew、OI 堆积行权价。
波动率指数(DVOL)单独取。全部 best-effort：任何失败返回 None，绝不拖垮整次取数。

纯解析/聚合逻辑抽成模块级函数（_summarize），方便用合成数据做单测、不联网。
"""

from __future__ import annotations

import time

from ._http import get_json
from .derivatives import OptionsProvider

_BASE = "https://www.deribit.com/api/v2"
# 币本位期权（currency=BASE 直接取，且有 DVOL 波动率指数）：BTC/ETH 主力市场
_COIN_MARGINED = {"BTC", "ETH"}
# USDC 本位线性期权（统一在 currency=USDC 下，按 {BASE}_USDC- 前缀过滤）：山寨
_USDC_MARGINED = {"SOL", "XRP", "AVAX", "TRX", "BNB", "MATIC"}


class DeribitSource(OptionsProvider):
    name = "deribit"

    def covers(self, base: str) -> bool:
        b = base.upper()
        return b in _COIN_MARGINED or b in _USDC_MARGINED

    def fetch_options_summary(self, base: str) -> dict | None:
        base = base.upper()
        try:
            if base in _COIN_MARGINED:
                data = get_json(
                    "Deribit",
                    f"{_BASE}/public/get_book_summary_by_currency",
                    params={"currency": base, "kind": "option"},
                )
                rows = data.get("result") or []
                dvol = self._dvol(base)
            elif base in _USDC_MARGINED:
                data = get_json(
                    "Deribit",
                    f"{_BASE}/public/get_book_summary_by_currency",
                    params={"currency": "USDC", "kind": "option"},
                )
                prefix = f"{base}_USDC-"
                rows = [
                    r
                    for r in (data.get("result") or [])
                    if str(r.get("instrument_name", "")).startswith(prefix)
                ]
                dvol = None  # DVOL 仅 BTC/ETH
            else:
                return None

            summary = _summarize(rows)
            if summary is None:
                return None
            summary["dvol"] = dvol
            return summary
        except Exception:  # noqa: BLE001 — best-effort
            return None

    def _dvol(self, base: str) -> float | None:
        try:
            now = int(time.time() * 1000)
            data = get_json(
                "Deribit",
                f"{_BASE}/public/get_volatility_index_data",
                params={
                    "currency": base,
                    "start_timestamp": now - 6 * 3600 * 1000,
                    "end_timestamp": now,
                    "resolution": 3600,
                },
            )
            series = (data.get("result") or {}).get("data") or []
            if not series:
                return None
            return round(float(series[-1][4]), 2)  # 最近一根的 close
        except Exception:  # noqa: BLE001
            return None


def _parse_instrument(name: str) -> tuple[str, float, str] | None:
    """'BTC-27JUN25-100000-C' → ('27JUN25', 100000.0, 'C')。解析失败返回 None。"""
    parts = name.split("-")
    if len(parts) != 4 or parts[3] not in ("C", "P"):
        return None
    try:
        return parts[1], float(parts[2]), parts[3]
    except ValueError:
        return None


def _summarize(rows: list[dict]) -> dict | None:
    """把全部期权合约聚合成情绪摘要。rows 来自 get_book_summary_by_currency。"""
    parsed = []
    underlying = None
    for r in rows:
        info = _parse_instrument(r.get("instrument_name", ""))
        oi = r.get("open_interest")
        if info is None or not oi:
            continue
        expiry, strike, kind = info
        parsed.append(
            {
                "expiry": expiry,
                "strike": strike,
                "kind": kind,
                "oi": float(oi),
                "iv": r.get("mark_iv"),
            }
        )
        if underlying is None and r.get("underlying_price"):
            underlying = float(r["underlying_price"])

    if not parsed or underlying is None:
        return None

    total_oi = sum(p["oi"] for p in parsed)
    call_oi = sum(p["oi"] for p in parsed if p["kind"] == "C")
    put_oi = sum(p["oi"] for p in parsed if p["kind"] == "P")
    pcr = round(put_oi / call_oi, 3) if call_oi else None
    if pcr is None:
        return None

    # 主力到期 = OI 最大的那个到期；max pain / 平值 IV / skew 都按它算
    by_expiry: dict[str, list[dict]] = {}
    for p in parsed:
        by_expiry.setdefault(p["expiry"], []).append(p)
    dominant_expiry = max(by_expiry, key=lambda e: sum(p["oi"] for p in by_expiry[e]))
    dominant = by_expiry[dominant_expiry]

    return {
        "underlying_price": round(underlying, 2),
        "put_call_oi_ratio": pcr,
        "total_oi_contracts": round(total_oi, 1),
        "nearest_expiry": dominant_expiry,
        "max_pain": _max_pain(dominant),
        "atm_iv": _atm_iv(dominant, underlying),
        "iv_skew_pct": _iv_skew(dominant, underlying),
        "top_oi_strikes": _top_strikes(dominant),
    }


def _max_pain(contracts: list[dict]) -> float | None:
    """最大痛点：到期时令所有期权持有人总内在价值最小的行权价。"""
    strikes = sorted({c["strike"] for c in contracts})
    if not strikes:
        return None
    best_k, best_pay = None, None
    for k in strikes:
        pay = 0.0
        for c in contracts:
            if c["kind"] == "C" and k > c["strike"]:
                pay += c["oi"] * (k - c["strike"])
            elif c["kind"] == "P" and k < c["strike"]:
                pay += c["oi"] * (c["strike"] - k)
        if best_pay is None or pay < best_pay:
            best_pay, best_k = pay, k
    return best_k


def _atm_iv(contracts: list[dict], underlying: float) -> float | None:
    """平值 IV：行权价最接近标的价的合约的 mark_iv。"""
    cands = [c for c in contracts if c.get("iv")]
    if not cands:
        return None
    atm = min(cands, key=lambda c: abs(c["strike"] - underlying))
    return round(float(atm["iv"]), 2)


def _iv_skew(contracts: list[dict], underlying: float) -> float | None:
    """风险逆转近似：~10% OTM put IV - ~10% OTM call IV。正=下行保护更贵(恐慌)。"""
    put_k = underlying * 0.9
    call_k = underlying * 1.1
    puts = [c for c in contracts if c["kind"] == "P" and c.get("iv")]
    calls = [c for c in contracts if c["kind"] == "C" and c.get("iv")]
    if not puts or not calls:
        return None
    p = min(puts, key=lambda c: abs(c["strike"] - put_k))
    c = min(calls, key=lambda c: abs(c["strike"] - call_k))
    return round(float(p["iv"]) - float(c["iv"]), 2)


def _top_strikes(contracts: list[dict], n: int = 4) -> list[dict]:
    """OI 堆积最多的行权价（合并同一行权价的看涨+看跌）。"""
    agg: dict[float, float] = {}
    for c in contracts:
        agg[c["strike"]] = agg.get(c["strike"], 0.0) + c["oi"]
    top = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[:n]
    return [{"strike": k, "oi": round(v, 1)} for k, v in top]
