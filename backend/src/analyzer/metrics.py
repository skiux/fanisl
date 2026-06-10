"""指标/数据元数据登记表——所有 metric 的**单一事实来源(SSOT)**。

为什么有这文件：metric 名以前散落在 flatten / backfill / 工具描述 / 提示词 / 文档里各写一遍，
改名要动 5 处、极易漂移。现在一律从这里取：
- `TF_METRICS`：逐周期技术指标（base 名 + 标签 + 单位 + 如何从 TimeframeView 取值）。
- `SCALAR_METRICS` / 宏观：其余所有标量 metric 的元信息。
- `catalog()`：给前端的完整目录；`flatten` 用 TF_METRICS 出名字；工具描述用 `metric_vocab()` 生成。

**新增/改一个 metric 的同步清单见 doc/data-sync.md。** 一致性由 tests/test_metrics.py 守护。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .data.fred_source import FRED_SERIES

# 前端格式化用的单位词汇：
#   price=价位 | pct=百分比 | rate=极小费率 | ratio=倍率 | ratio01=0~1 分位
#   score=0~100 | usd=美元金额 | count=计数 | bps=基点 | num=无量纲 | tokens=代币数 | index=指数
# category：technical | derivatives | microstructure | sentiment | onchain | macro | event
# ts_meaning：candle(K线周期) | sample(采样时刻) | settlement(结算) | day(所属日)
#            | reference_period(数据参考期，非发布时刻) | event(事件发生时刻)

# 逐周期技术指标的展示用周期（catalog 用；实际落库周期由采集/回填决定）
TIMEFRAMES = ("1w", "1d", "4h", "1h", "15m", "5m")


@dataclass(frozen=True)
class TfMetric:
    base: str
    label: str
    unit: str
    from_view: Callable  # TimeframeView -> value|None（flatten 用）


# 逐周期技术指标（与 indicators.compute.indicator_series 的 key 必须一致——test 守护）
TF_METRICS: list[TfMetric] = [
    TfMetric("change_pct", "周期涨跌", "pct", lambda v: v.change_pct),
    TfMetric("rsi", "RSI", "score", lambda v: v.momentum.rsi),
    TfMetric("macd_hist", "MACD 柱", "num", lambda v: v.momentum.macd_hist),
    TfMetric("atr", "ATR", "price", lambda v: v.volatility.atr),
    TfMetric("atr_pct", "ATR 分位", "ratio01", lambda v: v.volatility.atr_percentile),
    TfMetric("vol_ratio", "量比", "ratio", lambda v: v.volume.vs_avg20),
    TfMetric("bb_upper", "布林上轨", "price", lambda v: v.key_levels.bb_upper),
    TfMetric("bb_lower", "布林下轨", "price", lambda v: v.key_levels.bb_lower),
]
TF_BASES: list[str] = [m.base for m in TF_METRICS]


@dataclass(frozen=True)
class MetricDef:
    name: str
    category: str
    unit: str
    scope: str          # symbol | global
    label: str
    ts_meaning: str
    desc: str = ""


# 标量（非逐周期）metric——名字必须与 flatten/backfill 落库时一致
SCALAR_METRICS: list[MetricDef] = [
    MetricDef("price", "technical", "price", "symbol", "最新价", "candle"),
    # 衍生品
    MetricDef("funding_rate", "derivatives", "rate", "symbol", "资金费率", "settlement"),
    MetricDef("funding_annualized", "derivatives", "pct", "symbol", "资金费率年化", "settlement"),
    MetricDef("funding_percentile", "derivatives", "ratio01", "symbol", "资金费率分位", "sample"),
    MetricDef("open_interest_usd", "derivatives", "usd", "symbol", "未平仓量", "sample"),
    MetricDef("oi_change_24h", "derivatives", "pct", "symbol", "OI 24h 变化", "sample"),
    MetricDef("lsr", "derivatives", "ratio", "symbol", "多空账户比", "sample"),
    MetricDef("lsr_percentile", "derivatives", "ratio01", "symbol", "多空比分位", "sample"),
    MetricDef("top_trader_lsr", "derivatives", "ratio", "symbol", "大户持仓比", "sample"),
    MetricDef("top_trader_percentile", "derivatives", "ratio01", "symbol", "大户持仓比分位", "sample"),
    MetricDef("taker_buy_sell_ratio", "derivatives", "ratio", "symbol", "主动买卖量比", "sample"),
    MetricDef("taker_percentile", "derivatives", "ratio01", "symbol", "taker 分位", "sample"),
    MetricDef("basis_perp", "derivatives", "pct", "symbol", "永续溢价", "sample"),
    MetricDef("basis_quarterly", "derivatives", "pct", "symbol", "季度年化基差", "sample"),
    MetricDef("dvol", "derivatives", "pct", "symbol", "DVOL 波动率指数", "sample"),
    MetricDef("atm_iv", "derivatives", "pct", "symbol", "平值隐含波动率", "sample"),
    MetricDef("put_call_ratio", "derivatives", "ratio", "symbol", "看跌看涨比", "sample"),
    MetricDef("iv_skew", "derivatives", "pct", "symbol", "IV 偏斜", "sample"),
    MetricDef("max_pain", "derivatives", "price", "symbol", "最大痛点", "sample"),
    MetricDef("options_total_oi", "derivatives", "count", "symbol", "期权总未平仓", "sample"),
    MetricDef("liq_long_24h", "derivatives", "usd", "symbol", "多头爆仓 24h", "sample"),
    MetricDef("liq_short_24h", "derivatives", "usd", "symbol", "空头爆仓 24h", "sample"),
    MetricDef("liq_total_24h", "derivatives", "usd", "symbol", "总爆仓 24h", "sample"),
    # 盘口微观结构
    MetricDef("spread_bps", "microstructure", "bps", "symbol", "买卖价差", "sample"),
    MetricDef("ob_imbalance", "microstructure", "num", "symbol", "盘口失衡", "sample"),
    MetricDef("ob_bid_depth_usd", "microstructure", "usd", "symbol", "买盘深度", "sample"),
    MetricDef("ob_ask_depth_usd", "microstructure", "usd", "symbol", "卖盘深度", "sample"),
    # 情绪（社交当前无源，列出供前端目录）
    MetricDef("fear_greed", "sentiment", "score", "global", "恐惧贪婪指数", "day"),
    MetricDef("galaxy_score", "sentiment", "score", "symbol", "Galaxy 社交分", "sample"),
    MetricDef("social_dominance", "sentiment", "pct", "symbol", "社交占有率", "sample"),
    MetricDef("social_sentiment", "sentiment", "num", "symbol", "社交情绪", "sample"),
    # 链上
    MetricDef("stablecoin_total", "onchain", "usd", "global", "稳定币供应", "day"),
    MetricDef("stablecoin_change_7d", "onchain", "pct", "global", "稳定币 7d 变化", "day"),
    MetricDef("stablecoin_change_30d", "onchain", "pct", "global", "稳定币 30d 变化", "day"),
    MetricDef("chain_tvl", "onchain", "usd", "symbol", "公链 TVL", "day"),
    MetricDef("chain_tvl_change_30d", "onchain", "pct", "symbol", "TVL 30d 变化", "day"),
    MetricDef("active_addresses", "onchain", "count", "symbol", "活跃地址", "day"),
    MetricDef("tx_count", "onchain", "count", "symbol", "交易笔数", "day"),
    MetricDef("fees_usd", "onchain", "usd", "symbol", "网络手续费", "day"),
    # 事件型（回填专有）
    MetricDef("unlock_tokens", "event", "tokens", "symbol", "解锁量", "event"),
]

# 宏观：名字单一来源于 FRED_SERIES（fred_source），标签/单位在这里补
_MACRO_LABELS = {
    "cpi_yoy": "CPI 同比(通胀)", "core_cpi_yoy": "核心 CPI 同比", "core_pce_yoy": "核心 PCE 同比",
    "ppi_yoy": "PPI 同比", "cpi_index": "CPI 指数", "nonfarm_payrolls_chg": "非农月增",
    "unemployment_rate": "失业率", "initial_jobless_claims": "初请失业金", "gdp_growth": "GDP 增速",
    "retail_sales_yoy": "零售销售同比", "fed_funds_rate": "联邦基金利率", "fed_target_upper": "FOMC 目标上限",
    "us_10y_yield": "10年期收益率", "us_2y_yield": "2年期收益率", "yield_curve_10y2y": "10y-2y 利差",
    "m2_money_supply": "M2 货币供应", "fed_balance_sheet": "美联储资产负债表", "dxy_broad": "美元指数",
}
_MACRO_UNITS = {  # 默认 pct；这几个特殊
    "cpi_index": "index", "nonfarm_payrolls_chg": "count", "initial_jobless_claims": "count",
    "m2_money_supply": "usd", "fed_balance_sheet": "usd", "dxy_broad": "index",
}
MACRO_METRICS: list[MetricDef] = [
    MetricDef(name, "macro", _MACRO_UNITS.get(name, "pct"), "global",
              _MACRO_LABELS.get(name, name), "reference_period")
    for _sid, name, _units in FRED_SERIES
]


# --- 派生/查询 ----------------------------------------------------------------

def expand_tf_names(timeframes=TIMEFRAMES) -> list[str]:
    """逐周期技术指标展开成具体 metric 名，如 rsi_1d。"""
    return [f"{m.base}_{tf}" for tf in timeframes for m in TF_METRICS]


def all_metric_names(timeframes=TIMEFRAMES) -> set[str]:
    """登记表里所有可能出现的 metric 名（前向 + 回填）。"""
    names = set(expand_tf_names(timeframes))
    names |= {m.name for m in SCALAR_METRICS}
    names |= {m.name for m in MACRO_METRICS}
    return names


def catalog(timeframes=TIMEFRAMES) -> list[dict]:
    """给前端的完整 metric 目录：name/category/unit/scope/label/ts_meaning。"""
    out: list[dict] = []
    for tf in timeframes:
        for m in TF_METRICS:
            out.append({
                "name": f"{m.base}_{tf}", "category": "technical", "unit": m.unit,
                "scope": "symbol", "label": f"{m.label}·{tf}", "ts_meaning": "candle",
            })
    for m in SCALAR_METRICS + MACRO_METRICS:
        out.append({
            "name": m.name, "category": m.category, "unit": m.unit,
            "scope": m.scope, "label": m.label, "ts_meaning": m.ts_meaning,
        })
    return out


def metric_vocab() -> str:
    """给 get_metric_history 工具描述用的 metric 词汇表（按类别，自动与登记表同步）。"""
    lines = [
        "  • 技术(每周期带后缀 _1w/_1d/_4h/_1h/_15m/_5m)：" + ", ".join(TF_BASES) + "；以及 price。",
    ]
    for cat, title in (("derivatives", "衍生品"), ("microstructure", "盘口"),
                       ("onchain", "链上"), ("sentiment", "情绪"), ("macro", "宏观(GLOBAL)")):
        names = [m.name for m in (SCALAR_METRICS + MACRO_METRICS) if m.category == cat]
        if names:
            lines.append(f"  • {title}：" + ", ".join(names) + "。")
    return "\n".join(lines)
