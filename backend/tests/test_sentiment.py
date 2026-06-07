"""情绪与注意力（Part 3）纯逻辑单测：builder + 各源解析（不联网）。"""

from analyzer.data.alternativeme_source import _bucket
from analyzer.data.lunarcrush_source import _parse_social
from analyzer.snapshot.builder import build_sentiment


def test_build_sentiment_both_blocks():
    s = build_sentiment(
        {"value": 12, "label": "Extreme Fear", "state": "extreme_fear"},
        {"galaxy_score": 60.0, "alt_rank": 5, "social_dominance": 2.5,
         "sentiment": 55.0, "interactions_24h": 1_000_000.0},
    )
    assert s.fear_greed.state == "extreme_fear"
    assert s.fear_greed.value == 12
    assert s.social.galaxy_score == 60.0
    assert s.social.alt_rank == 5


def test_build_sentiment_only_fear_greed():
    s = build_sentiment({"value": 80, "label": "Extreme Greed", "state": "extreme_greed"}, None)
    assert s.fear_greed.state == "extreme_greed"
    assert s.social is None


def test_build_sentiment_none():
    assert build_sentiment(None, None) is None


def test_fear_greed_bucket_fallback():
    assert _bucket(10) == "extreme_fear"
    assert _bucket(35) == "fear"
    assert _bucket(50) == "neutral"
    assert _bucket(65) == "greed"
    assert _bucket(90) == "extreme_greed"


def test_parse_social_coerces_types():
    out = _parse_social(
        {"galaxy_score": 61, "alt_rank": "5", "social_dominance": 2.3,
         "sentiment": 58, "interactions_24h": 1234}
    )
    assert out["galaxy_score"] == 61.0
    assert out["alt_rank"] == 5  # 字符串转 int
    assert out["social_dominance"] == 2.3


def test_parse_social_all_missing_is_none():
    assert _parse_social({"unrelated": 1}) is None
