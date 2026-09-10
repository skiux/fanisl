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
_OBS = "https://api.stlouisfed.org/fred/series/observations"

# FRED 宏观数值时间序列（GLOBAL，回填用）：(series_id, 入库 metric 名, units)。
# units：lin=原始水平值，pc1=同比%（通胀类用它），chg=环比变化（非农用它）。
FRED_SERIES = [
    # 物价 / 通胀（pc1 = 同比%，这才是"通胀率"）
    ("CPIAUCSL", "cpi_yoy", "pc1"),                # CPI 同比（headline 通胀）
    ("CPILFESL", "core_cpi_yoy", "pc1"),           # 核心 CPI 同比
    ("PCEPILFE", "core_pce_yoy", "pc1"),           # 核心 PCE 同比（美联储最看重）
    ("PPIACO", "ppi_yoy", "pc1"),                  # PPI 同比
    ("CPIAUCSL", "cpi_index", "lin"),              # CPI 指数水平（≠通胀，备用）
    # 就业
    ("PAYEMS", "nonfarm_payrolls_chg", "chg"),     # 非农月度新增（千人）
    ("UNRATE", "unemployment_rate", "lin"),        # 失业率
    ("ICSA", "initial_jobless_claims", "lin"),     # 初请失业金（周）
    # 增长 / 消费
    ("A191RL1Q225SBEA", "gdp_growth", "lin"),      # 实际 GDP 年化增速%
    ("RSAFS", "retail_sales_yoy", "pc1"),          # 零售销售同比
    # 利率 / 货币（FOMC 结果 + 收益率曲线 + 流动性）
    ("FEDFUNDS", "fed_funds_rate", "lin"),         # 联邦基金有效利率
    ("DFEDTARU", "fed_target_upper", "lin"),       # FOMC 目标利率上限（决议结果）
    ("DGS10", "us_10y_yield", "lin"),              # 10 年期国债收益率
    ("DGS2", "us_2y_yield", "lin"),                # 2 年期
    ("T10Y2Y", "yield_curve_10y2y", "lin"),        # 10y-2y 利差（衰退指标）
    ("M2SL", "m2_money_supply", "lin"),            # M2 货币供应
    ("WALCL", "fed_balance_sheet", "lin"),         # 美联储资产负债表规模
    ("DTWEXBGS", "dxy_broad", "lin"),              # 美元广义指数
]

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

    def fetch_series_history(self, series_id: str, units: str = "lin") -> list[dict]:
        """某 FRED 经济序列的数值全历史 [{ts, value}]（回填用）。

        units：lin=原始水平、pc1=同比%（通胀）、chg=环比变化（非农）。
        """
        if not self._key:
            return []
        try:
            data = get_json(
                "FRED", _OBS,
                params={"series_id": series_id, "api_key": self._key,
                        "file_type": "json", "sort_order": "asc", "units": units},
            )
            out = []
            for o in data.get("observations") or []:
                val, date = o.get("value"), o.get("date")
                if not date or val in (None, "", "."):  # "." = FRED 缺失值
                    continue
                try:
                    out.append({"ts": f"{date}T00:00:00+00:00", "value": float(val)})
                except (TypeError, ValueError):
                    continue
            return out
        except Exception:  # noqa: BLE001
            return []


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
