"""多源新闻解析 + 聚合去重 单测（合成响应，不联网）。"""

from analyzer.data.benzinga_source import _parse_benzinga
from analyzer.data.catalysts import NewsProvider
from analyzer.data.cryptocompare_source import _parse_news as parse_cc
from analyzer.data.finnhub_source import _parse_finnhub
from analyzer.data.news_aggregate import MultiNewsProvider
from analyzer.data.newsapi_source import _parse_newsapi


def test_parse_newsapi_enriched():
    data = {"articles": [{
        "source": {"name": "Reuters"}, "title": "ETH rallies", "description": "desc here",
        "url": "http://x", "urlToImage": "http://img", "publishedAt": "2026-06-07T10:00:00Z",
    }]}
    out = _parse_newsapi(data)[0]
    assert out["title"] == "ETH rallies" and out["source"] == "Reuters"
    assert out["summary"] == "desc here" and out["image_url"] == "http://img"
    assert out["provider"] == "newsapi"


def test_parse_finnhub_relevance_and_fallback():
    rows = [
        {"datetime": 1780000000, "headline": "BTC news", "source": "S", "url": "u1",
         "summary": "b", "related": "BTC", "category": "crypto", "image": "i"},
        {"datetime": 1780000100, "headline": "BTC again", "source": "S", "url": "u2",
         "related": "BTC,ETH", "category": "crypto"},
        {"datetime": 1780000200, "headline": "BTC three", "source": "S", "url": "u3",
         "related": "", "category": "crypto"},
        {"datetime": 1780000300, "headline": "SOL only", "source": "S", "url": "u4",
         "related": "SOL", "category": "crypto"},
    ]
    out = _parse_finnhub(rows, "BTC")
    titles = [o["title"] for o in out]
    assert "BTC news" in titles and "SOL only" not in titles  # 过滤到 BTC 相关
    assert out[0]["tickers"] == ["BTC"] and out[0]["provider"] == "finnhub"


def test_parse_finnhub_fallback_when_few_matches():
    rows = [{"datetime": 1780000000, "headline": "macro", "source": "S", "url": f"u{i}",
             "related": "", "category": "crypto"} for i in range(5)]
    out = _parse_finnhub(rows, "BTC")  # 无匹配 → 回退大盘流
    assert len(out) == 5


def test_parse_benzinga_enriched():
    data = [{
        "created": "Sat, 07 Jun 2026 10:00:00 -0400", "title": "Crypto moves",
        "teaser": "short teaser", "url": "http://b", "stocks": [{"name": "BTC"}],
        "channels": [{"name": "Cryptocurrency"}], "image": [{"size": "large", "url": "http://i"}],
    }]
    out = _parse_benzinga(data)[0]
    assert out["title"] == "Crypto moves" and out["summary"] == "short teaser"
    assert out["tickers"] == ["BTC"] and out["categories"] == ["Cryptocurrency"]
    assert out["image_url"] == "http://i" and out["published_at"].startswith("2026-06-07")


def test_cryptocompare_enriched():
    data = {"Data": [{
        "published_on": 1780000000, "title": "T", "url": "http://c", "body": "long body",
        "categories": "BTC|ETH|MARKET", "source_info": {"name": "CoinDesk"}, "imageurl": "http://i",
    }]}
    out = parse_cc(data)[0]
    assert out["summary"] == "long body" and out["image_url"] == "http://i"
    assert "BTC" in out["tickers"] and out["provider"] == "cryptocompare"


class _Fake(NewsProvider):
    name = "f"

    def __init__(self, rows):
        self._rows = rows

    def fetch_news(self, symbol=None):
        return self._rows


def test_multi_dedup_and_sort():
    a = _Fake([{"title": "dup", "url": "http://same", "published_at": "2026-06-07T09:00:00Z"}])
    b = _Fake([
        {"title": "DUP", "url": "http://same/", "published_at": "2026-06-07T09:00:00Z"},  # 同 url(尾斜杠) → 去重
        {"title": "newer", "url": "http://other", "published_at": "2026-06-07T11:00:00Z"},
    ])
    out = MultiNewsProvider([a, b]).fetch_news("BTC")
    assert len(out) == 2  # 去掉一条重复
    assert out[0]["title"] == "newer"  # 按时间倒序


def test_multi_best_effort_on_provider_failure():
    class Boom(NewsProvider):
        name = "boom"
        def fetch_news(self, symbol=None):
            raise RuntimeError("x")

    ok = _Fake([{"title": "ok", "url": "http://ok", "published_at": "2026-06-07T10:00:00Z"}])
    out = MultiNewsProvider([Boom(), ok]).fetch_news("BTC")
    assert out and out[0]["title"] == "ok"
