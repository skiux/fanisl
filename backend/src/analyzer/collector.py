"""采集器：定时把 watchlist 全维度数据写成时间序列。

复用现有工具函数 get_market_snapshot / get_catalysts 取数（不碰数据源代码），
再用 flatten 摊平入库。best-effort：单币/单源失败不影响其余，结果记 collection_runs。
"""

from __future__ import annotations

from datetime import datetime, timezone

from .config import Settings
from .data.catalysts import Catalysts
from .data.derivatives import CryptoSentiment
from .data.instruments import Resolver
from .flatten import flatten_catalysts, flatten_snapshot
from .marketstore import MarketStore
from .tools.catalysts import get_catalysts
from .tools.market import get_market_snapshot

_COLLECT_TFS = ["1h", "1d"]  # 采集只需价格(1h)+日线RSI；减轻 OHLCV 负载


def _cycle_ts() -> str:
    """采集周期时间戳：截断到分钟，使同周期所有样本共用一个 ts（全市场指标天然去重）。"""
    return datetime.now(timezone.utc).replace(second=0, microsecond=0).isoformat()


def collect_market(
    resolver: Resolver,
    settings: Settings,
    sentiment: CryptoSentiment | None,
    store: MarketStore,
) -> None:
    """采一轮 watchlist 行情快照 → 时间序列。"""
    ts = _cycle_ts()
    ok, fails = 0, []
    for sym in settings.watchlist:
        try:
            snap = get_market_snapshot(sym, _COLLECT_TFS, resolver, settings, sentiment)
            store.write_samples(flatten_snapshot(snap), ts)
            ok += 1
        except Exception as e:  # noqa: BLE001 — best-effort per symbol
            fails.append(f"{sym}:{str(e)[:60]}")
    store.log_run("market", not fails, f"{ok}/{len(settings.watchlist)} ok"
                  + (f"; fail {'; '.join(fails)}" if fails else ""))


def collect_catalysts(
    catalysts: Catalysts | None,
    settings: Settings,
    store: MarketStore,
) -> None:
    """采一轮 watchlist 催化剂（解锁/宏观/新闻）→ catalyst_items（先删后插）。"""
    ok, fails = 0, []
    macro_done = False
    for sym in settings.watchlist:
        try:
            report = get_catalysts(sym, catalysts)
            for kind, scope, items in flatten_catalysts(report, sym):
                if kind == "macro":
                    if macro_done:
                        continue
                    macro_done = True
                store.replace_catalysts(kind, scope, items)
            ok += 1
        except Exception as e:  # noqa: BLE001
            fails.append(f"{sym}:{str(e)[:60]}")
    store.log_run("catalysts", not fails, f"{ok}/{len(settings.watchlist)} ok"
                  + (f"; fail {'; '.join(fails)}" if fails else ""))
