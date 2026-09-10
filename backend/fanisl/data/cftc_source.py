"""CFTC COT 持仓数据源（Commitments of Traders，免费公开 API，无 key）。

走 CFTC Socrata 公开端点的 **Disaggregated Futures-Only** 报告（数据集 72hh-3qpy）：
把持仓拆成 生产商/贸易商(prod_merc)、互换交易商(swap)、管理基金(managed money=投机)、
其它可报告、非报告。商品研究看这份（区别于金融期货的 TFF）。

**时点要害**：report_date 是**周二 as-of**，但报告**周五下午才发布**。回测里能用的时刻是发布时刻，
不是周二。本源原样返回 report_date，由调用方（backfill_cot）偏移到发布时点入库，杜绝未来函数。

历史可回溯到 ~2006。免费、稳定、best-effort 失败返回 []。
"""

from __future__ import annotations

from ._http import get_json

_BASE = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"

# 主力合约的 CFTC contract market code（已实地核验）
CONTRACT_CODES = {
    "XAU/USD": "088691",   # GOLD - COMMODITY EXCHANGE INC.
    "XAG/USD": "084691",   # SILVER - COMMODITY EXCHANGE INC.
    "CL": "067651",        # WTI-PHYSICAL - NYMEX
}

# 取用字段（Socrata 返回字符串，调用方转 float）
_FIELDS = [
    "report_date_as_yyyy_mm_dd", "open_interest_all",
    "m_money_positions_long_all", "m_money_positions_short_all",
    "prod_merc_positions_long", "prod_merc_positions_short",
    "swap_positions_long_all", "swap__positions_short_all",
]


class CftcSource:
    name = "cftc"

    def fetch_cot_history(self, contract_code: str, *, limit: int = 5000) -> list[dict]:
        """某合约的周度 COT 历史，升序。每条含原始持仓分项（managed money / 商业）+ OI。

        返回 [{report_date(str), oi, mm_long, mm_short, prod_merc_long/short,
               swap_long/short}]，数值已转 float。best-effort 失败返回 []。
        """
        try:
            data = get_json(
                "CFTC", _BASE,
                params={
                    "cftc_contract_market_code": contract_code,
                    "$select": ",".join(_FIELDS),
                    "$order": "report_date_as_yyyy_mm_dd ASC",
                    "$limit": limit,
                },
                timeout=30.0,
            )
        except Exception:  # noqa: BLE001 — best-effort
            return []
        if not isinstance(data, list):
            return []
        out = []
        for r in data:
            try:
                out.append({
                    "report_date": r["report_date_as_yyyy_mm_dd"][:10],
                    "oi": float(r["open_interest_all"]),
                    "mm_long": float(r["m_money_positions_long_all"]),
                    "mm_short": float(r["m_money_positions_short_all"]),
                    "prod_merc_long": float(r["prod_merc_positions_long"]),
                    "prod_merc_short": float(r["prod_merc_positions_short"]),
                    "swap_long": float(r["swap_positions_long_all"]),
                    "swap_short": float(r["swap__positions_short_all"]),
                })
            except (KeyError, TypeError, ValueError):
                continue
        return out
