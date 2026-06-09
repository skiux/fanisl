"""工具定义表（给 Claude 的 JSON schema）+ 分发逻辑。

加新工具（信号、回测、新闻）就在这里登记 schema + 加一个 dispatch 分支，agent 不用动。
"""

from __future__ import annotations

import json

from ..config import Settings
from ..data.base import DataSourceError, SymbolNotFound
from ..data.catalysts import Catalysts
from ..data.derivatives import CryptoSentiment
from ..data.instruments import Resolver, registered_symbols
from ..marketstore import MarketStore
from ..models import GetCatalystsInput, GetMarketSnapshotInput, GetMetricHistoryInput
from .catalysts import get_catalysts
from .history import get_metric_history
from .market import get_market_snapshot

# 给 Claude 看的工具定义（input_schema 用 JSON Schema）
TOOLS: list[dict] = [
    {
        "name": "get_market_snapshot",
        "description": (
            "获取某标的的多周期行情快照：已算好的技术指标（均线/RSI/MACD/布林/ATR/量比），"
            "加密永续还含衍生品情绪（资金费率/未平仓量/多空比/大户多空比/基差期限结构/"
            "期权情绪/爆仓数据），均已阈值化成语义标签。"
            "需要任何实时行情数据时调用它；不要凭记忆编造价格或指标。\n"
            "支持的标的：① 加密——任意 CCXT 交易对，如 BTC/USDT、ETH/USDT、SOL/USDT；"
            "② 美股/指数/原油——" + ", ".join(registered_symbols()) + "。"
            "股票/金属/原油没有衍生品，只有技术面。\n"
            "周期：建议**省略 timeframes**，由后端按标的给默认（加密/金属=1h/4h/1d；"
            "美股/指数/原油只有日线及以上=1d/1wk，没有日内 1h/4h，别去请求）。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "标的符号，如 BTC/USDT、NVDA、NDX、XAU、CL",
                },
                "timeframes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "周期数组，如 ['1h','4h','1d']；省略则用该标的默认周期",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_catalysts",
        "description": (
            "获取某币（或全市场）的事件与催化剂——与价格正交、需要推理的信息：\n"
            "① 代币解锁/归属（供给冲击：未来解锁量及占供给比例、最近一次解锁的时间/类别）；"
            "② 宏观日历（FOMC/CPI/利率，币与宏观高度联动）；③ 币圈事件（上所/主网/升级/黑客）；"
            "④ 新闻标题；⑤ BTC/ETH 现货 ETF 资金流。\n"
            "什么时候调用：用户问「有什么催化剂/利好利空」「为什么涨跌」「接下来要盯什么」"
            "「有没有解锁/数据/事件」，或你做盘面判断时需要事件背景。给 symbol 看该币 + 相关全市场；"
            "省略 symbol 只看全市场（宏观/ETF/大盘新闻）。\n"
            "注意：很多块可能因数据源未配置而为空（看 warnings），就明说拿不到，别编。"
            "解锁数据仅归属型代币有（BTC/ETH 等无）。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "币种符号，如 ARB、SOL、BTC；省略则只看全市场催化剂",
                }
            },
        },
    },
    {
        "name": "get_metric_history",
        "description": (
            "读某指标的历史时间序列（后台每 15 分钟采集、持久化），用来做**趋势/拐点/分位/"
            "基准率**推理——快照只有当下一个点，这个工具给你时间维度。\n"
            "什么时候用：想知道「资金费率连续负了多久」「OI 是在累积还是收缩」「恐惧贪婪一周前多少、"
            "现在 12 处于历史什么分位」「稳定币供应/TVL 的方向」「现价在近 30 天什么位置」等。\n"
            "返回每个指标：current/first/min/max、time_weighted_mean、time_weighted_percentile、"
            "span_hours、change_abs/change_pct、direction(rising/falling/flat)、稀疏轨迹。\n"
            "★分位语义务必分清两类，别混：\n"
            "  - 快照里的 funding_percentile / lsr_percentile / atr_pct_：是**数据源取数时**用其"
            "自身近期固定回看窗口算好的分位，描述「当下读数在它最近分布里的高低」。\n"
            "  - 本工具的 time_weighted_percentile：是**你指定的查询窗口内、按每个值的持续时长加权**"
            "的分位（当前值之下的时间占比）。因为序列按变化落库(sample-and-hold)，必须按时长加权，"
            "否则只存在几分钟的尖峰会被高估。time_weighted_mean 同理。span_hours 是实际覆盖时长，"
            "样本少/覆盖短就据此说明不确定。\n"
            "可用 metrics——单币(symbol 传 BTC/USDT 等)：\n"
            "  • 技术(每周期带后缀 _1h/_4h/_1d)：rsi_, macd_hist_, atr_, atr_pct_, vol_ratio_, "
            "change_pct_, bb_upper_, bb_lower_；以及 price。\n"
            "  • 衍生品：funding_rate, funding_annualized, funding_percentile, open_interest_usd, "
            "oi_change_24h, lsr, lsr_percentile, top_trader_lsr, top_trader_percentile, "
            "taker_buy_sell_ratio, taker_percentile, basis_perp, "
            "basis_quarterly, dvol, atm_iv, put_call_ratio, iv_skew, max_pain, options_total_oi, "
            "liq_long_24h, liq_short_24h, liq_total_24h。\n"
            "  • 盘口微观结构：spread_bps, ob_imbalance, ob_bid_depth_usd, ob_ask_depth_usd。\n"
            "  • 链上：chain_tvl, chain_tvl_change_30d, active_addresses, tx_count, fees_usd。\n"
            "全市场(symbol 传 GLOBAL)：fear_greed, stablecoin_total, stablecoin_change_7d, stablecoin_change_30d。\n"
            "注意：采集按各指标自身节奏落库(值不变就不重复记)，所以慢变量(日线/链上/恐惧贪婪)"
            "的点会比较稀疏、那是正常的；起步阶段样本可能很少(samples 小)，据实说明、别过度解读。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "币种(如 BTC/USDT) 或 GLOBAL"},
                "metrics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "要查的指标名数组（见说明里的可用列表）",
                },
                "window": {
                    "type": "string",
                    "description": "时间窗口：24h | 7d | 30d | 90d | all（默认 30d）",
                },
            },
            "required": ["symbol", "metrics"],
        },
    },
]


def dispatch_tool(
    name: str,
    tool_input: dict,
    resolver: Resolver,
    settings: Settings,
    sentiment: CryptoSentiment | None = None,
    catalysts: Catalysts | None = None,
    store: MarketStore | None = None,
) -> tuple[str, bool]:
    """执行工具，返回 (content_json_str, is_error)。永不抛异常给上层。"""
    try:
        if name == "get_market_snapshot":
            args = GetMarketSnapshotInput.model_validate(tool_input)
            snapshot = get_market_snapshot(
                args.symbol, args.timeframes, resolver, settings, sentiment
            )
            return (
                json.dumps(snapshot.model_dump(), ensure_ascii=False),
                False,
            )
        if name == "get_catalysts":
            args = GetCatalystsInput.model_validate(tool_input)
            report = get_catalysts(args.symbol, catalysts)
            return (json.dumps(report.model_dump(), ensure_ascii=False), False)
        if name == "get_metric_history":
            if store is None:
                return (json.dumps({"error": "历史数据存储未配置"}, ensure_ascii=False), True)
            args = GetMetricHistoryInput.model_validate(tool_input)
            out = get_metric_history(args.symbol, args.metrics, args.window, store)
            return (json.dumps(out, ensure_ascii=False), False)
        return (json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False), True)
    except SymbolNotFound as e:
        return (json.dumps({"error": f"交易对不存在: {e}"}, ensure_ascii=False), True)
    except DataSourceError as e:
        return (json.dumps({"error": f"取数失败: {e}"}, ensure_ascii=False), True)
    except Exception as e:  # noqa: BLE001 — 兜底，任何错误都转成结构化结果
        return (json.dumps({"error": f"工具执行异常: {e}"}, ensure_ascii=False), True)
