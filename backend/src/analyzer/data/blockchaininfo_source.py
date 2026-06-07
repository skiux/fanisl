"""Blockchain.info 链上网络使用度（BTC，公开 API，无需 key）。

活跃地址 / 交易笔数 / 手续费(USD)——真实使用与需求。每个指标 best-effort，
单个图表失败不影响其余。目前仅 BTC（ETH 等网络指标需另接源，见 data-gaps）。
"""

from __future__ import annotations

from ._http import get_json
from .onchain import NetworkActivityProvider

_CHARTS = "https://api.blockchain.info/charts"


class BlockchainInfoSource(NetworkActivityProvider):
    name = "blockchain.info"

    def fetch_network(self, base: str) -> dict | None:
        if base.upper() != "BTC":
            return None
        active = _chart_values("n-unique-addresses")
        tx = _chart_values("n-transactions")
        fees = _chart_values("transaction-fees-usd")
        if not any([active, tx, fees]):
            return None
        out = {
            "active_addresses": _last(active),
            "active_addresses_change_7d_pct": _change_7d(active),
            "tx_count": _last(tx),
            "fees_usd": _last(fees),
        }
        if all(v is None for v in out.values()):
            return None
        return out


def _chart_values(chart: str) -> list | None:
    try:
        data = get_json(
            "Blockchain.info",
            f"{_CHARTS}/{chart}",
            params={"timespan": "10days", "format": "json", "cors": "true"},
        )
        return data.get("values") or None
    except Exception:  # noqa: BLE001
        return None


def _last(values: list | None) -> float | None:
    if not values:
        return None
    return round(float(values[-1]["y"]), 2)


def _change_7d(values: list | None) -> float | None:
    if not values or len(values) < 8:
        return None
    now = float(values[-1]["y"])
    then = float(values[-8]["y"])
    if not then:
        return None
    return round((now - then) / then * 100, 2)
