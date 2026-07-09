"""EIA 开放数据 API v2（能源信息署，免费 key）。

H18 用：周度石油库存（Weekly Petroleum Status Report 的数据侧）。
- 路由如 petroleum/stoc/wstk，series 如 WCESTUS1（美国商业原油库存 ex-SPR，千桶）。
- period = 报告周截止日（周五）；**发布**在次周三 10:30 ET（假期周顺延周四），
  发布时点打戳由调用方（backfill_eia）负责——本层只忠实返回 (period, value)。
- JSON 单次最多 5000 行；分页 offset + 批间 sleep（探测实测 2283 行，通常一页取完）。
"""

from __future__ import annotations

import time

from ._http import get_json

_BASE = "https://api.eia.gov/v2"
_PAGE = 5000
_SLEEP_S = 1.5  # 批量请求间隔（限流礼貌；DEMO_KEY 档位更严）


class EIASource:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def fetch_weekly_series(self, route: str, series_id: str) -> list[dict]:
        """拉某路由下一条周度 series 的全历史，按 period 升序返回 [{period, value}]。"""
        out: list[dict] = []
        offset = 0
        while True:
            data = get_json(
                "eia",
                f"{_BASE}/{route}/data/",
                params={
                    "api_key": self.api_key,
                    "frequency": "weekly",
                    "data[0]": "value",
                    "facets[series][]": series_id,
                    "sort[0][column]": "period",
                    "sort[0][direction]": "asc",
                    "length": _PAGE,
                    "offset": offset,
                },
                retry_statuses=(429,),
            )
            resp = data.get("response") or {}
            rows = resp.get("data") or []
            for r in rows:
                v = r.get("value")
                if v is None:
                    continue
                out.append({"period": r["period"], "value": float(v)})
            total = int(resp.get("total") or 0)
            offset += len(rows)
            if not rows or offset >= total:
                break
            time.sleep(_SLEEP_S)
        return out
