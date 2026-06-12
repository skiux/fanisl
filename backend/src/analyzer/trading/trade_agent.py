"""Claude 交易决策层：进场 / 持仓重评 / 复盘 三类结构化调用。

复用 agent 的工具循环（数据工具 get_market_snapshot/catalysts/history）+ 缓存 + adaptive
thinking；每个阶段挂一个**终结工具**（submit_trade_plan / decline_trade / submit_adjustment /
submit_review），Claude 必须以调用终结工具收尾，其 input 用 pydantic 校验成结构化结果。
冻结输入：把预取的决策上下文 + 完整对话 transcript 一并交给调用方落库（decision_inputs）。
"""

from __future__ import annotations

import json

import anthropic

from ..config import Settings
from ..data.catalysts import Catalysts
from ..data.derivatives import CryptoSentiment
from ..data.instruments import Resolver
from ..marketstore import MarketStore
from ..prompts import (
    ENTRY_SYSTEM_PROMPT,
    MANAGE_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    SCAN_SYSTEM_PROMPT,
)
from ..tools.catalysts import get_catalysts
from ..tools.market import get_market_snapshot
from ..tools.registry import TOOLS, dispatch_tool
from .models import Adjustment, DeclineDecision, Review, ScanResult, TradePlan

_CACHE = {"type": "ephemeral"}
_MAX_ITERS = 8


def _term_tool(name: str, desc: str, model) -> dict:
    return {"name": name, "description": desc, "input_schema": model.model_json_schema()}


ENTRY_TERMINALS = [
    _term_tool("submit_trade_plan", "提交结构化进场计划（决策依据 + 交易计划）。", TradePlan),
    _term_tool("decline_trade", "判断这笔不值得做，提交不交易的理由。", DeclineDecision),
]
MANAGE_TERMINALS = [_term_tool("submit_adjustment", "提交持仓调整决策。", Adjustment)]
REVIEW_TERMINALS = [_term_tool("submit_review", "提交结构化复盘。", Review)]
SCAN_TERMINALS = [_term_tool("submit_scan", "提交扫描候选（值得做完整分析的标的，可为空）。", ScanResult)]


class TradeAgent:
    def __init__(
        self, settings: Settings, resolver: Resolver,
        sentiment: CryptoSentiment | None, catalysts: Catalysts | None,
        market_store: MarketStore | None,
    ) -> None:
        self.settings = settings
        self.resolver = resolver
        self.sentiment = sentiment
        self.catalysts = catalysts
        self.market_store = market_store
        self.client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key or None,
            base_url=settings.anthropic_base_url or None,
            max_retries=settings.anthropic_max_retries,  # 第三方代理偶发限流/池空，多重试几次自愈
            timeout=settings.anthropic_timeout_s,
        )

    # --- 公开入口 --------------------------------------------------------

    def decide_entry(self, symbol: str, account_summary: dict, *, force: bool = False) -> dict:
        """让 Claude 决定是否进场。返回 {kind: plan|decline, plan|decline, inputs, transcript}。

        force=True（强制交易模式）：不提供 decline_trade 终结工具，Claude 必须给出可执行计划。
        """
        context = self._entry_context(symbol, account_summary)
        terminals = [ENTRY_TERMINALS[0]] if force else ENTRY_TERMINALS
        note = (
            "\n\n**强制交易模式已开启**：本次必须给出一份可执行的进场计划(submit_trade_plan)，"
            "不允许不交易；即便信号一般，也要选出相对最优的方向与结构，并如实说明置信度与风险。"
            "信念不足时用**低 risk_pct（可低至 0.25%）+ 诚实的 confidence_pct** 表达勉强——"
            "把'不情愿'变成可观测的连续量，而不是硬凑一个自信的计划。"
            if force else ""
        )
        first = (
            f"请评估是否在 {symbol} 开一笔交易。下面是已为你预取的决策上下文(JSON)，"
            f"可再用工具补充历史/分位等。{note}\n\n```json\n{json.dumps(context, ensure_ascii=False)}\n```"
        )
        name, payload, transcript = self._run(ENTRY_SYSTEM_PROMPT, first, terminals)
        if name == "submit_trade_plan":
            plan = TradePlan.model_validate({**payload, "symbol": symbol})
            return {"kind": "plan", "plan": plan, "inputs": context, "transcript": transcript}
        decline = DeclineDecision.model_validate({**payload, "symbol": symbol})
        return {"kind": "decline", "decline": decline, "inputs": context, "transcript": transcript}

    def scan(self, symbols: list[str], max_candidates: int) -> dict:
        """triage：给一批标的精简盘面，挑出值得做完整分析的候选。返回 {result, digests, transcript}。

        逐标的 best-effort 取精简快照（单源失败/限流即跳过），只把摘要喂给 Claude，不让它在
        triage 阶段调数据工具（控成本）。返回 ScanResult。
        """
        digests, skipped = self._scan_digests(symbols)
        if not digests:
            return {"result": ScanResult(), "digests": {}, "transcript": [], "skipped": skipped}
        first = (
            f"当前可用持仓额度：最多再挑 {max_candidates} 个。下面是各标的精简盘面摘要(JSON)，"
            f"做 triage 挑出值得完整分析的候选；没有像样机会就返回空。"
            f"\n\n```json\n{json.dumps(digests, ensure_ascii=False, default=str)}\n```"
        )
        system = SCAN_SYSTEM_PROMPT.replace("{max_candidates}", str(max_candidates))
        _, payload, transcript = self._run(system, first, SCAN_TERMINALS, allow_data_tools=False)
        return {
            "result": ScanResult.model_validate(payload),
            "digests": digests, "transcript": transcript, "skipped": skipped,
        }

    def _scan_digests(self, symbols: list[str]) -> tuple[dict, list[str]]:
        digests: dict[str, dict] = {}
        skipped: list[str] = []
        tfs = self.settings.trading_scan_timeframes
        for sym in symbols:
            try:
                snap = get_market_snapshot(sym, tfs, self.resolver, self.settings, self.sentiment)
                digests[sym] = self._digest(snap)
            except Exception as e:  # noqa: BLE001 — 限流/无数据即跳过
                skipped.append(f"{sym}:{str(e)[:40]}")
        return digests, skipped

    @staticmethod
    def _digest(snap) -> dict:
        """从完整快照抽精简摘要（控 token）：逐周期趋势/RSI/涨跌 + 衍生品要点。"""
        d: dict = {"asset_class": snap.meta.asset_class}
        ref = snap.timeframes.get("1d") or next(iter(snap.timeframes.values()), None)
        if ref is not None:
            d["price"] = ref.last_price
        d["tf"] = {
            tf: {"trend": v.trend.ema_alignment, "rsi": v.momentum.rsi, "chg%": v.change_pct}
            for tf, v in snap.timeframes.items()
        }
        dv = snap.derivatives
        if dv:
            if dv.funding_rate: d["funding"] = dv.funding_rate.value
            if dv.long_short_ratio: d["lsr_bias"] = dv.long_short_ratio.bias
            if dv.oi_price_divergence: d["oi_div"] = dv.oi_price_divergence
        if snap.meta.data_warnings:
            d["warn"] = len(snap.meta.data_warnings)
        return d

    def decide_management(self, trade: dict, plan: dict, position: dict) -> dict:
        """持仓中被唤醒：返回 {adjustment, inputs, transcript}。"""
        context = self._manage_context(trade["symbol"], plan, position)
        first = (
            f"这笔 {trade['symbol']} {trade['side']} 仓位需要重评。原始计划与当前状态(JSON)如下，"
            f"可用工具看最新行情。\n\n```json\n{json.dumps(context, ensure_ascii=False)}\n```"
        )
        _, payload, transcript = self._run(MANAGE_SYSTEM_PROMPT, first, MANAGE_TERMINALS)
        return {"adjustment": Adjustment.model_validate(payload), "inputs": context, "transcript": transcript}

    def review_trade(self, timeline: dict) -> dict:
        """已平仓复盘：返回 {review, transcript}。timeline 来自 store.timeline()。"""
        digest = self._review_digest(timeline)
        first = (
            "这笔交易已平仓，请基于完整时间线与客观结果做诚实复盘(JSON 见下)。"
            f"\n\n```json\n{json.dumps(digest, ensure_ascii=False, default=str)}\n```"
        )
        _, payload, transcript = self._run(REVIEW_SYSTEM_PROMPT, first, REVIEW_TERMINALS, allow_data_tools=False)
        return {"review": Review.model_validate(payload), "transcript": transcript}

    # --- 工具循环 --------------------------------------------------------

    def _run(self, system_text: str, first_user: str, terminals: list[dict],
             *, allow_data_tools: bool = True) -> tuple[str, dict, list[dict]]:
        """跑到 Claude 调用某个终结工具为止，返回 (终结工具名, input, 完整 messages)。"""
        tools = (TOOLS if allow_data_tools else []) + terminals
        term_names = {t["name"] for t in terminals}
        system = [{"type": "text", "text": system_text, "cache_control": _CACHE}]
        messages: list[dict] = [{"role": "user", "content": first_user}]

        for i in range(_MAX_ITERS):
            force = i == _MAX_ITERS - 1  # 最后一轮强制收尾
            # 最后一轮**只留终结工具**：否则 tool_choice=any 可能又去调数据工具，导致跑满轮数仍没
            # 结构化结果 → RuntimeError → 整个请求 500、白烧若干次 Claude 调用、什么都没落库。
            resp = self.client.messages.create(
                model=self.settings.model,
                max_tokens=self.settings.max_tokens,
                system=system,
                tools=terminals if force else tools,
                thinking={"type": "adaptive"},
                output_config={"effort": "high"},
                tool_choice={"type": "any"} if force else {"type": "auto"},
                messages=_with_cache(messages),
            )
            messages.append({"role": "assistant", "content": [b.model_dump(mode="json") for b in resp.content]})

            terminal = next((b for b in resp.content if b.type == "tool_use" and b.name in term_names), None)
            if terminal is not None:
                return terminal.name, dict(terminal.input), messages

            if resp.stop_reason != "tool_use":
                # 没调工具也没收尾：催一次
                messages.append({"role": "user", "content": "请用相应的 submit_/decline_ 工具提交结构化结果。"})
                continue

            messages.append({"role": "user", "content": self._dispatch(resp)})

        raise RuntimeError("Claude 未在限定轮数内提交结构化结果")

    def _dispatch(self, resp) -> list[dict]:
        results = []
        for b in resp.content:
            if b.type == "tool_use":
                content, is_error = dispatch_tool(
                    b.name, b.input, self.resolver, self.settings,
                    self.sentiment, self.catalysts, self.market_store,
                )
                results.append({"type": "tool_result", "tool_use_id": b.id,
                                "content": content, "is_error": is_error})
        return results

    # --- 上下文装配 ------------------------------------------------------

    def _entry_context(self, symbol: str, account_summary: dict) -> dict:
        snap = get_market_snapshot(
            symbol, self.settings.trading_decision_timeframes,
            self.resolver, self.settings, self.sentiment,
        )
        cat = get_catalysts(symbol, self.catalysts)
        return {
            "symbol": symbol,
            "account": account_summary,
            "snapshot": snap.model_dump(),
            "catalysts": cat.model_dump(),
        }

    def _manage_context(self, symbol: str, plan: dict, position: dict) -> dict:
        # 重评用精简周期（控 token/成本），大周期定调 + 交易/入场周期看当下即可
        snap = get_market_snapshot(
            symbol, self.settings.trading_manage_timeframes,
            self.resolver, self.settings, self.sentiment,
        )
        return {"symbol": symbol, "original_plan": plan, "position": position, "snapshot": snap.model_dump()}

    def _review_digest(self, timeline: dict) -> dict:
        return {
            "trade": timeline.get("trade"),
            "plans": [{"version": p["version"], "plan": p["plan"]} for p in timeline.get("plans", [])],
            "orders": timeline.get("orders"),
            "events": [{"ts": e["ts"], "kind": e["kind"], "actor": e["actor"], "payload": e.get("payload")}
                       for e in timeline.get("events", [])],
            "result": timeline.get("result"),
        }


def _with_cache(messages: list[dict]) -> list[dict]:
    """给最后一条消息打缓存断点（不改存储），命中不断增长的上下文前缀。"""
    if not messages:
        return messages
    msgs = list(messages)
    last = dict(msgs[-1])
    content = last["content"]
    if isinstance(content, str):
        content = [{"type": "text", "text": content, "cache_control": _CACHE}]
    else:
        content = [dict(b) for b in content]
        content[-1] = {**content[-1], "cache_control": _CACHE}
    last["content"] = content
    msgs[-1] = last
    return msgs
