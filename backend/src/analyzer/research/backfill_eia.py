"""回填 EIA 周度原油商业库存（ex-SPR），供 H18（库存 surprise 事件研究）回测。

**入库 ts = 发布时刻**（period 周五 + 5 天 = 次周三 10:30 ET，zoneinfo 换算 UTC，
夏令 14:30Z / 冬令 15:30Z）——严格无未来函数，参考 backfill_cot 的 _publish_ts。
假期周实际顺延周四 11:00 ET：无免费的逐条历史发布时刻，由 H18 进场约定
（发布 ts 之后第一根日线 = 周四结算）的缓冲吸收，见预注册。

写 metric_samples：scope=symbol, symbol='CL', metric='eia_crude_stocks'（千桶原值）。
跑：`python -m analyzer.research.backfill_eia`（幂等，可重跑）。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..config import get_settings
from ..data.eia_source import EIASource
from ..db import make_pool
from ..marketstore import MarketStore

ROUTE = "petroleum/stoc/wstk"
SERIES = "WCESTUS1"          # U.S. Ending Stocks excluding SPR of Crude Oil (MBBL)
METRIC = "eia_crude_stocks"
SYMBOL = "CL"
PUB_LAG_DAYS = 5             # 周五 period → 次周三
PUB_HOUR, PUB_MIN = 10, 30   # 10:30 ET（当地钟点，DST 由 zoneinfo 处理）
_ET = ZoneInfo("America/New_York")


def _publish_ts(period: str) -> str:
    """period（周五）→ 次周三 10:30 ET 的 UTC ISO。无未来函数的关键一步。"""
    d = datetime.strptime(period, "%Y-%m-%d")
    pub_local = (d + timedelta(days=PUB_LAG_DAYS)).replace(
        hour=PUB_HOUR, minute=PUB_MIN, tzinfo=_ET,
    )
    return pub_local.astimezone(ZoneInfo("UTC")).isoformat()


def main() -> None:
    s = get_settings()
    key = s.eia_api_key or "DEMO_KEY"
    if not s.eia_api_key:
        print("警告：.env 无 EIA_API_KEY，用 DEMO_KEY（限流严）。请注册 eia.gov/opendata。")
    pool = make_pool(s.pg_conninfo)
    store = MarketStore(pool)
    try:
        hist = EIASource(key).fetch_weekly_series(ROUTE, SERIES)
        rows = [("symbol", SYMBOL, METRIC, _publish_ts(h["period"]), h["value"]) for h in hist]
        n = store.write_history(rows)
        span = f"{hist[0]['period']}→{hist[-1]['period']}" if hist else "-"
        print(f"  {SYMBOL} {METRIC}: {len(hist)} 周 → 写入 {n} 行 [{span}]")
        if len(hist) == 0:
            print("  0 行：数据源异常，检查 key/路由。")  # 0 行要显式告警（研究日志教训）
    finally:
        pool.close()


if __name__ == "__main__":
    main()
