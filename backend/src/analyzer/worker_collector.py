"""collector 进程入口：只跑数据采集调度（market / catalysts），与 API、交易隔离。

时效优先：采集有自己独立的调度线程，不会被交易里分钟级的 Claude 调用拖住。
启动：`python -m analyzer.worker_collector`（systemd: fanisl-collector.service）。
"""

from __future__ import annotations

from . import runtime as rt
from .collector import collect_catalysts, collect_market
from .knowledge.daily import run_daily as knowledge_daily
from .scheduler import Scheduler
from .worker_base import LOCK_COLLECTOR, acquire_single_instance, run_workers


def main() -> None:
    if not rt.settings.collector_enabled:
        raise SystemExit("collector_enabled=false，collector 不启动。")
    acquire_single_instance(rt.pool, LOCK_COLLECTOR, "collector")
    sched = Scheduler([
        ("market", rt.settings.collect_market_interval_s,
         lambda: collect_market(rt.resolver, rt.settings, rt.sentiment, rt.market_store)),
        ("catalysts", rt.settings.collect_catalysts_interval_s,
         lambda: collect_catalysts(rt.catalysts, rt.settings, rt.market_store)),
        ("knowledge", rt.settings.knowledge_daily_interval_s,
         lambda: knowledge_daily(rt.knowledge_pool)),
    ])
    run_workers([sched], name="collector")


if __name__ == "__main__":
    main()
