"""端到端跑通工具循环：mock Anthropic client，但用真实的
data→indicators→snapshot→tool 流水线（合成数据，不联网）。
"""

import pandas as pd

from analyzer.agent import Agent, final_text
from analyzer.config import Settings
from analyzer.data.base import MarketDataSource
from analyzer.data.instruments import Resolver


class FakeSource(MarketDataSource):
    name = "fake"
    supports_derivatives = True

    def fetch_ohlcv(self, symbol, timeframe, limit):
        closes = [100.0 + i * 0.5 for i in range(120)]
        rows = [
            {
                "ts": pd.Timestamp("2024-01-01", tz="UTC") + pd.Timedelta(hours=i),
                "open": c,
                "high": c + 1,
                "low": c - 1,
                "close": c,
                "volume": 100.0 + i,
            }
            for i, c in enumerate(closes)
        ]
        return pd.DataFrame(rows)

    def fetch_funding_rate(self, symbol):
        return {"value": 0.0006}

    def fetch_open_interest(self, symbol):
        return {"value_usd": 1e10, "change_24h_pct": 8.0}

    def fetch_long_short_ratio(self, symbol):
        return {"value": 1.8}


class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self, mode=None):
        return dict(self.__dict__)


class _Resp:
    def __init__(self, content, stop_reason):
        self.content = content
        self.stop_reason = stop_reason


class _Messages:
    def __init__(self):
        self.calls = 0
        self.last_kwargs = None

    def create(self, **kwargs):
        self.calls += 1
        self.last_kwargs = kwargs
        if self.calls == 1:
            return _Resp(
                [
                    _Block(
                        type="tool_use",
                        id="t1",
                        name="get_market_snapshot",
                        input={"symbol": "BTC/USDT", "timeframes": ["1h", "4h"]},
                    )
                ],
                "tool_use",
            )
        return _Resp(
            [_Block(type="text", text="**趋势判断**：偏多。\n（以上为盘面解读，非投资建议）")],
            "end_turn",
        )


class _Client:
    def __init__(self):
        self.messages = _Messages()


def _agent():
    settings = Settings(anthropic_api_key="test")
    resolver = Resolver({"okx": FakeSource()})
    agent = Agent(settings, resolver)
    agent.client = _Client()
    return agent


def test_run_turn_tool_loop():
    agent = _agent()
    out = agent.run_turn([{"role": "user", "content": "BTC 怎么看？"}])

    assert [m["role"] for m in out] == ["user", "assistant", "user", "assistant"]

    tool_result = out[2]["content"][0]
    assert tool_result["type"] == "tool_result"
    assert tool_result["is_error"] is False
    assert "timeframes" in tool_result["content"]  # 真实快照 JSON
    assert "趋势判断" in final_text(out[-1]["content"])
    assert agent.client.messages.calls == 2


def test_cache_breakpoint_on_last_message():
    agent = _agent()
    agent.run_turn([{"role": "user", "content": "ETH 呢？"}])
    # 最后一次 create 时，最后一条消息（tool_result）末块应带 cache_control
    msgs = agent.client.messages.last_kwargs["messages"]
    last_block = msgs[-1]["content"][-1]
    assert last_block.get("cache_control") == {"type": "ephemeral"}
