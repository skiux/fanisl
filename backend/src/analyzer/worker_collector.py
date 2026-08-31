"""collector 进程入口：只跑数据采集调度（market / catalysts），与 API、交易隔离。

时效优先：采集有自己独立的调度线程，不会被交易里分钟级的 Claude 调用拖住。
启动：`python -m analyzer.worker_collector`（systemd: fanisl-collector.service）。
"""

from __future__ import annotations

from . import runtime as rt
from .collector import collect_catalysts, collect_market
from .knowledge.daily import run_daily as knowledge_daily
from .knowledge.discovery import weekly_report as knowledge_weekly
from .knowledge import news_triage
from .knowledge.reference import refresh_earnings, refresh_news, refresh_profiles
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
        ("knowledge_weekly", rt.settings.knowledge_weekly_interval_s,
         lambda: knowledge_weekly(rt.knowledge_pool)),
    ])
    # 参考数据单独一条车道：Polygon 限速让"刷资料"要跑十几分钟，与 sched 同线程会把
    # 15 分钟一轮的行情采集顶掉（scheduler 是单线程顺序执行的）。
    reference = Scheduler([
        ("asset_news", rt.settings.asset_news_interval_s,
         lambda: refresh_news(rt.knowledge_pool, days=rt.settings.asset_news_days)),
        ("asset_earnings", rt.settings.asset_earnings_interval_s,
         lambda: refresh_earnings(rt.knowledge_pool)),
        # 降噪跟在抓取后面：规则免费，LLM 那半只判规则拿不准的（见 news_triage）
        ("news_triage", rt.settings.news_triage_interval_s,
         lambda: news_triage.run(rt.knowledge_pool, rt.settings)),
        ("asset_profiles", rt.settings.asset_profile_interval_s,
         lambda: refresh_profiles(rt.knowledge_pool)),
    ])
    run_workers([sched, reference], name="collector")


if __name__ == "__main__":
    main()
