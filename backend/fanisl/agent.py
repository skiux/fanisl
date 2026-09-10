"""Claude 多轮对话 + 工具循环——整个后端的心脏。

要点（来自 claude-api 最佳实践）：
- 手写 agentic loop：stop_reason == "tool_use" 就执行工具、把 tool_result 塞回继续；
  否则是最终回复，返回。
- prompt caching：渲染顺序是 tools → system → messages，在最后一个 system 块上打
  cache_control，即可把 tools + system 整段缓存；同时给最近一条消息打一个断点，
  让不断增长的对话前缀（含大块快照 JSON）也命中缓存。
- adaptive thinking：盘面分析是推理密集任务，开自适应思考提升质量。
- 完整保存每轮 content blocks（含 thinking / tool_use），历史才合法、可回放。
"""

from __future__ import annotations

import time

import anthropic

from .config import Settings
from .data.catalysts import Catalysts
from .data.derivatives import CryptoSentiment
from .data.instruments import Resolver
from .marketstore import MarketStore
from .prompts import SYSTEM_PROMPT
from .tools.registry import TOOLS, dispatch_tool

_CACHE = {"type": "ephemeral"}


class Agent:
    def __init__(
        self,
        settings: Settings,
        resolver: Resolver,
        sentiment: CryptoSentiment | None = None,
        catalysts: Catalysts | None = None,
        store: MarketStore | None = None,
    ) -> None:
        self.settings = settings
        self.resolver = resolver
        self.sentiment = sentiment
        self.catalysts = catalysts
        self.store = store
        self.client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key or None,
            base_url=settings.anthropic_base_url or None,
            max_retries=settings.anthropic_max_retries,  # 第三方代理偶发限流/池空，多重试几次自愈
            timeout=settings.anthropic_timeout_s,
        )

    # --- 静态前缀（缓存 tools + system）---------------------------------

    @property
    def _system(self) -> list[dict]:
        return [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": _CACHE}]

    def run_turn(self, history: list[dict]) -> list[dict]:
        """跑完一整轮对话（可能多次调用工具），返回追加了新消息的 history。"""
        while True:
            resp = self.client.messages.create(
                model=self.settings.model,
                max_tokens=self.settings.max_tokens,
                system=self._system,
                tools=TOOLS,
                thinking={"type": "adaptive"},
                output_config={"effort": "high"},
                messages=_with_cache_breakpoint(history),
            )

            history.append(
                {
                    "role": "assistant",
                    "content": [b.model_dump(mode="json") for b in resp.content],
                }
            )

            if resp.stop_reason != "tool_use":
                return history

            history.append(
                {
                    "role": "user",
                    "content": _run_tools(
                        resp, self.resolver, self.settings, self.sentiment, self.catalysts, self.store
                    ),
                }
            )

    def stream_turn(self, history: list[dict]):
        """工具循环 + 服务端逐字输出。yield (event, data)：
        - ("status", dict)  正在调用某工具（给前端显示"正在获取 XX 行情…"）
        - ("delta", str)    文本片段（打字机）

        v1 用非流式 create()（中转对 tools+thinking 的真流式不稳、stop_reason 会丢），
        把最终文本在服务端切片吐出。就地把新消息追加进 history（调用方结束后落库）。
        """
        while True:
            resp = self.client.messages.create(
                model=self.settings.model,
                max_tokens=self.settings.max_tokens,
                system=self._system,
                tools=TOOLS,
                thinking={"type": "adaptive"},
                output_config={"effort": "high"},
                messages=_with_cache_breakpoint(history),
            )
            content = [b.model_dump(mode="json") for b in resp.content]
            history.append({"role": "assistant", "content": content})

            for block in content:
                if block.get("type") == "text" and block.get("text"):
                    yield from self._emit_text(block["text"])

            if resp.stop_reason != "tool_use":
                return

            for block in resp.content:
                if block.type == "tool_use":
                    yield ("status", {"phase": "tool", "tool": block.name, "input": block.input})
            history.append(
                {
                    "role": "user",
                    "content": _run_tools(
                        resp, self.resolver, self.settings, self.sentiment, self.catalysts, self.store
                    ),
                }
            )

    def _emit_text(self, text: str):
        size = max(1, self.settings.stream_chunk)
        delay = self.settings.stream_delay_ms / 1000.0
        for i in range(0, len(text), size):
            yield ("delta", text[i : i + size])
            if delay:
                time.sleep(delay)


def _run_tools(resp, resolver, settings, sentiment=None, catalysts=None, store=None) -> list[dict]:
    """执行 assistant 消息里的所有 tool_use，返回 tool_result 块列表。"""
    results = []
    for block in resp.content:
        if block.type == "tool_use":
            content, is_error = dispatch_tool(
                block.name, block.input, resolver, settings, sentiment, catalysts, store
            )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": content,
                    "is_error": is_error,
                }
            )
    return results


def _with_cache_breakpoint(history: list[dict]) -> list[dict]:
    """返回 history 的浅拷贝，给最后一条消息的最后一个内容块打 cache_control。

    不改动存储里的 history（断点只在请求时注入）。循环里最后一条消息恒为 user
    （初始用户消息 或 刚塞回的 tool_results），所以不会给 thinking 块打断点。
    """
    if not history:
        return history
    msgs = list(history)
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


def final_text(content_blocks: list[dict]) -> str:
    """从最终 assistant content blocks 里抽出纯文本回复。"""
    parts = [b.get("text", "") for b in content_blocks if b.get("type") == "text"]
    return "\n".join(p for p in parts if p).strip()
