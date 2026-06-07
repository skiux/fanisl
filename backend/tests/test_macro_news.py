"""Part 2 宏观(FRED) + 新闻(CryptoCompare) 纯逻辑单测（不联网）。"""

from analyzer.data.cryptocompare_source import _parse_news
from analyzer.data.fred_source import _build_calendar


def test_build_calendar_curates_dedupes_windows_excludes_fomc():
    today = "2026-06-07"
    rd = [
        {"release_name": "Consumer Price Index", "date": "2026-06-10"},
        {"release_name": "Consumer Price Index", "date": "2026-07-10"},  # 同类后一次→去重丢弃
        {"release_name": "FOMC Press Release", "date": "2026-06-08"},  # 排除
        {"release_name": "Producer Price Index", "date": "2026-06-11"},
        {"release_name": "Gross Domestic Product", "date": "2026-09-01"},  # 超 14 天窗口
        {"release_name": "Random Release", "date": "2026-06-09"},  # 非高影响
    ]
    out = _build_calendar(rd, today, 14)
    names = [e["name"] for e in out]
    assert any("CPI" in n for n in names)
    assert any("PPI" in n for n in names)
    assert all("FOMC" not in n for n in names)  # FOMC 被排除
    assert all("GDP" not in n for n in names)  # 超窗口
    assert all("Random" not in n for n in names)
    assert out[0]["date"] == "2026-06-10"  # 按日期升序
    assert sum(1 for n in names if "CPI" in n) == 1  # 去重到一次


def test_build_calendar_excludes_past():
    today = "2026-06-07"
    rd = [{"release_name": "Consumer Price Index", "date": "2026-06-01"}]  # 过去
    assert _build_calendar(rd, today, 14) == []


def test_parse_news_maps_fields():
    data = {"Data": [
        {"published_on": 1780000000, "title": "BTC up", "source_info": {"name": "CoinDesk"}, "url": "http://x"},
    ]}
    out = _parse_news(data)
    assert out[0]["title"] == "BTC up"
    assert out[0]["source"] == "CoinDesk"
    assert out[0]["url"] == "http://x"
    assert out[0]["published_at"].startswith("20")  # ISO


def test_parse_news_empty():
    assert _parse_news({"Data": []}) == []
    assert _parse_news({}) == []
