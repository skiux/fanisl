"""get_catalysts 编排单测：fake provider + 缺源 warning 行为（不联网）。"""

from analyzer.data.catalysts import Catalysts, MacroCalendarProvider, UnlockProvider
from analyzer.tools.catalysts import get_catalysts


class FakeUnlocks(UnlockProvider):
    name = "fake"

    def fetch_unlocks(self, symbol):
        if symbol != "ARB":
            return None
        return {
            "symbol": "ARB",
            "protocol": "arbitrum",
            "next_event": {
                "date": "2026-07-01",
                "tokens": 1000.0,
                "pct_of_max_supply": 1.0,
                "category": "team",
                "type": "cliff",
            },
            "next_30d_pct_of_supply": 1.0,
            "next_90d_pct_of_supply": 1.0,
            "max_supply": 100000.0,
        }


class FakeMacro(MacroCalendarProvider):
    name = "fake"

    def fetch_calendar(self, days=14):
        return [{"date": "2026-06-12", "name": "CPI", "importance": "high"}]


def test_get_catalysts_with_unlocks_and_macro():
    rep = get_catalysts("ARB/USDT", Catalysts(unlocks=FakeUnlocks(), macro=FakeMacro()))
    assert rep.symbol == "ARB"
    assert rep.token_unlocks.next_event.category == "team"
    assert rep.macro_calendar[0].name == "CPI"
    # events/news 未接入 → warning
    assert any("币圈事件未接入" in w for w in rep.warnings)
    assert any("新闻未接入" in w for w in rep.warnings)


def test_get_catalysts_unconfigured_warns_not_fabricates():
    rep = get_catalysts("BTC", Catalysts())  # 全空
    assert rep.token_unlocks is None
    assert any("解锁数据未接入" in w for w in rep.warnings)
    assert any("ETF 资金流未接入" in w for w in rep.warnings)  # BTC 触发 ETF 检查


def test_get_catalysts_unknown_token_unlocks_none():
    rep = get_catalysts("DOGE", Catalysts(unlocks=FakeUnlocks()))
    assert rep.token_unlocks is None
    assert any("无解锁数据" in w for w in rep.warnings)


def test_get_catalysts_no_symbol_skips_unlocks():
    rep = get_catalysts(None, Catalysts(unlocks=FakeUnlocks(), macro=FakeMacro()))
    assert rep.symbol is None
    assert rep.token_unlocks is None
    assert rep.macro_calendar[0].name == "CPI"  # 全市场维度照常
