"""FRED 宏观日历（圣路易斯联储，免费 key）。

用 /fred/releases/dates 取「即将发布」的高影响美国经济数据。要点：
- 必须 include_release_dates_with_no_data=true 才有前瞻日期；但该模式下 FOMC 会被填成
  「每天一条」噪声，故**排除 FOMC**（其余 CPI/PPI/就业/GDP/PCE/零售 的前瞻日期是干净的）。
- FRED 只给日期，**没有市场预期值/重要度/实际值**（要这些得 Trading Economics 等付费）。
  重要度由本地按发布类型粗标。FOMC/利率决议日期=已知缺口（见 data-gaps）。
"""

from __future__ import annotations

import datetime

from ._http import get_json
from .catalysts import MacroCalendarProvider

_BASE = "https://api.stlouisfed.org/fred/releases/dates"

# 高影响发布 → (中文名, 重要度)。FOMC 不在此（FRED 前瞻模式下噪声大）。
_HIGH_IMPACT = {
    "Consumer Price Index": ("CPI 消费者物价指数", "high"),
    "Employment Situation": ("非农就业 Employment Situation", "high"),
    "Gross Domestic Product": ("GDP 国内生产总值", "high"),
    "Personal Income and Outlays": ("PCE 个人消费支出", "high"),
    "Producer Price Index": ("PPI 生产者物价指数", "medium"),
    "Advance Monthly Sales for Retail and Food Services": ("零售销售 Retail Sales", "medium"),
}


class FREDSource(MacroCalendarProvider):
    name = "fred"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    def fetch_calendar(self, days: int = 14) -> list[dict] | None:
        if not self._key:
            return None
        try:
            today = datetime.date.today().isoformat()
            data = get_json(
                "FRED",
                _BASE,
                params={
                    "api_key": self._key,
                    "file_type": "json",
                    "sort_order": "asc",
                    "include_release_dates_with_no_data": "true",
                    "realtime_start": today,
                    "limit": 1000,
                },
            )
            return _build_calendar(data.get("release_dates") or [], today, days)
        except Exception:  # noqa: BLE001 — best-effort
            return None


def _build_calendar(release_dates: list, today: str, days: int) -> list[dict]:
    """筛未来 days 天内的高影响发布，按发布类型去重到最近一次，按日期升序。"""
    end = (datetime.date.fromisoformat(today) + datetime.timedelta(days=days)).isoformat()
    seen: dict[str, dict] = {}
    for x in release_dates:
        name = x.get("release_name")
        date = x.get("date")
        if not name or not date or name in seen:
            continue
        if name not in _HIGH_IMPACT or not (today <= date <= end):
            continue
        cn, importance = _HIGH_IMPACT[name]
        seen[name] = {"date": date, "name": cn, "importance": importance}
    return sorted(seen.values(), key=lambda e: e["date"])
