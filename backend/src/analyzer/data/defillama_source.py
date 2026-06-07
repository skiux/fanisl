"""DefiLlama 代币解锁数据源（公开数据集 CDN，无需 key）。

官方 /emissions 端点已转付费(402)，但前端用的静态数据集 CDN 仍公开可取：
- {DATASETS}/emissionsProtocolsList  → 有解锁数据的 protocol slug 列表
- {DATASETS}/emissions/{slug}        → 该 protocol 的完整归属/解锁日程
- {API}/protocols                    → 全量 protocol（含 symbol↔slug 映射）

symbol→slug 映射首次用时拉一次并缓存。解析逻辑(_parse_unlocks)抽成纯函数便于单测。
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from ._http import get_json
from .catalysts import UnlockProvider
from .onchain import ChainTvlProvider, StablecoinProvider

_DATASETS = "https://defillama-datasets.llama.fi"
_API = "https://api.llama.fi"
_STABLECOINS = "https://stablecoins.llama.fi"


class DefiLlamaSource(UnlockProvider):
    name = "defillama"

    def __init__(self) -> None:
        self._sym2slug: dict[str, str] | None = None

    def _ensure_map(self) -> None:
        if self._sym2slug is not None:
            return
        unlock_slugs = set(
            get_json("DefiLlama", f"{_DATASETS}/emissionsProtocolsList")
        )
        protos = get_json("DefiLlama", f"{_API}/protocols")
        m: dict[str, str] = {}
        for p in protos:
            slug = p.get("slug")
            sym = (p.get("symbol") or "").upper()
            if slug in unlock_slugs and sym and sym != "-" and sym not in m:
                m[sym] = slug
        self._sym2slug = m

    def fetch_unlocks(self, symbol: str) -> dict | None:
        try:
            base = symbol.split("/")[0].split(":")[0].upper()
            self._ensure_map()
            slug = (self._sym2slug or {}).get(base)
            if slug is None:
                return None  # 非归属代币（如 BTC）或 DefiLlama 无该币解锁数据
            data = get_json("DefiLlama", f"{_DATASETS}/emissions/{slug}")
            return _parse_unlocks(base, slug, data)
        except Exception:  # noqa: BLE001 — best-effort
            return None


class DefiLlamaOnChain(StablecoinProvider, ChainTvlProvider):
    """DefiLlama 链上免费数据（无 key）：全市场稳定币供应 + 公链 TVL。"""

    name = "defillama"

    def __init__(self) -> None:
        self._sym2chain: dict[str, str] | None = None  # tokenSymbol → chain name

    def fetch_stablecoins(self) -> dict | None:
        try:
            data = get_json(
                "DefiLlama", f"{_STABLECOINS}/stablecoins", params={"includePrices": "false"}
            )
            assets = data.get("peggedAssets") if isinstance(data, dict) else None
            return _parse_stablecoins(assets or [])
        except Exception:  # noqa: BLE001
            return None

    def _ensure_chains(self) -> None:
        if self._sym2chain is not None:
            return
        chains = get_json("DefiLlama", f"{_API}/v2/chains")
        m: dict[str, str] = {}
        for c in chains:
            sym = (c.get("tokenSymbol") or "").upper()
            if sym and sym not in m and c.get("name"):
                m[sym] = c["name"]
        self._sym2chain = m

    def fetch_chain_tvl(self, base: str) -> dict | None:
        try:
            self._ensure_chains()
            chain = (self._sym2chain or {}).get(base.upper())
            if chain is None:
                return None  # 非 L1 原生币
            hist = get_json("DefiLlama", f"{_API}/v2/historicalChainTvl/{chain}")
            return _parse_chain_tvl(chain, hist)
        except Exception:  # noqa: BLE001
            return None


def _pct(now: float, then: float | None) -> float | None:
    if not then:
        return None
    return round((now - then) / then * 100, 2)


def _parse_stablecoins(assets: list) -> dict | None:
    def total(key: str) -> float:
        return sum(float((a.get(key) or {}).get("peggedUSD") or 0.0) for a in assets)

    now = total("circulating")
    if now <= 0:
        return None
    return {
        "total_usd": round(now, 0),
        "change_7d_pct": _pct(now, total("circulatingPrevWeek")),
        "change_30d_pct": _pct(now, total("circulatingPrevMonth")),
    }


def _parse_chain_tvl(chain: str, hist: list) -> dict | None:
    if not hist:
        return None
    now = float(hist[-1].get("tvl") or 0.0)
    if now <= 0:
        return None
    ago30 = float(hist[-31]["tvl"]) if len(hist) >= 31 else None
    return {
        "chain": chain,
        "tvl_usd": round(now, 0),
        "change_30d_pct": _pct(now, ago30),
    }


def _iso_date(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def _tokens_of(event: dict) -> float:
    return float(sum(event.get("noOfTokens") or []))


def _parse_unlocks(symbol: str, slug: str, data: dict) -> dict | None:
    md = data.get("metadata") or {}
    events = md.get("events") or []
    supply = data.get("supplyMetrics") or {}
    max_supply = supply.get("maxSupply") or md.get("total")

    now = int(time.time())
    upcoming = sorted(
        [e for e in events if isinstance(e, dict) and (e.get("timestamp") or 0) > now],
        key=lambda e: e["timestamp"],
    )

    def pct(tok: float) -> float | None:
        return round(tok / max_supply * 100, 3) if max_supply else None

    if not upcoming:
        return {
            "symbol": symbol,
            "protocol": slug,
            "max_supply": max_supply,
            "note": "无即将到来的解锁（多为已基本解锁完毕）",
        }

    nxt = upcoming[0]
    nxt_tok = _tokens_of(nxt)
    h30, h90 = now + 30 * 86400, now + 90 * 86400
    tok30 = sum(_tokens_of(e) for e in upcoming if e["timestamp"] <= h30)
    tok90 = sum(_tokens_of(e) for e in upcoming if e["timestamp"] <= h90)

    return {
        "symbol": symbol,
        "protocol": slug,
        "max_supply": max_supply,
        "next_event": {
            "date": _iso_date(nxt["timestamp"]),
            "tokens": round(nxt_tok, 2),
            "pct_of_max_supply": pct(nxt_tok),
            "category": nxt.get("category"),
            "type": nxt.get("unlockType") or "cliff",
        },
        "next_30d_pct_of_supply": pct(tok30),
        "next_90d_pct_of_supply": pct(tok90),
    }
