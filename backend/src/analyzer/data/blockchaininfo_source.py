"""Blockchain.info 链上网络使用度（BTC，公开 API，无需 key）。

活跃地址 / 交易笔数 / 手续费(USD)——真实使用与需求。每个指标 best-effort，
单个图表失败不影响其余。目前仅 BTC（ETH 等网络指标需另接源，见 data-gaps）。
"""

from __future__ import annotations

from datetime import datetime, timezone

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

    def fetch_network_history(self, base: str) -> dict:
        """BTC 网络使用度全历史：{metric: [{ts, value}]}（日级，多年）。回填用。"""
        if base.upper() != "BTC":
            return {}
        out: dict = {}
        for metric, chart in (
            ("active_addresses", "n-unique-addresses"),
            ("tx_count", "n-transactions"),
            ("fees_usd", "transaction-fees-usd"),
        ):
            vals = _chart_values(chart, timespan="all")
            if vals:
                out[metric] = [
                    {"ts": datetime.fromtimestamp(int(p["x"]), tz=timezone.utc).isoformat(),
                     "value": float(p["y"])}
                    for p in vals if p.get("x") is not None and p.get("y") is not None
                ]
        return out


def _chart_values(chart: str, timespan: str = "10days") -> list | None:
    try:
        data = get_json(
            "Blockchain.info",
            f"{_CHARTS}/{chart}",
            params={"timespan": timespan, "format": "json", "cors": "true"},
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
