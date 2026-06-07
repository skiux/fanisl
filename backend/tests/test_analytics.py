"""时间序列摘要 + get_metric_history 单测（临时 SQLite，不联网）。"""

from analyzer.analytics import summarize_series
from analyzer.marketstore import GLOBAL, MarketStore, Sample
from analyzer.tools.history import get_metric_history


def _pts(values, start_h=0):
    return [
        {"ts": f"2026-06-{1 + i:02d}T00:00:00+00:00", "value": v}
        for i, v in enumerate(values)
    ]


def test_summarize_basic_rising():
    s = summarize_series(_pts([10, 20, 30, 40, 50]))
    assert s["samples"] == 5
    assert s["current"] == 50 and s["first"] == 10
    assert s["min"] == 10 and s["max"] == 50 and s["mean"] == 30
    assert s["direction"] == "rising"
    assert s["percentile_in_window"] == 0.8  # 4/5 小于 50
    assert s["change_pct"] == 400.0
    assert len(s["trajectory"]) == 5


def test_summarize_flat_within_deadband():
    # 中间有波动但首尾基本持平 → flat（按首尾变化相对区间幅度判断）
    s = summarize_series(_pts([100, 108, 92, 100]))
    assert s["direction"] == "flat"


def test_summarize_empty():
    assert summarize_series([]) == {"samples": 0}


def test_summarize_downsamples():
    s = summarize_series(_pts(list(range(40))), max_traj=8)
    assert len(s["trajectory"]) == 8  # 抽稀到 8
    assert s["trajectory"][0][1] == 0 and s["trajectory"][-1][1] == 39  # 保留首尾


def test_get_metric_history_reads_store(tmp_path):
    st = MarketStore(str(tmp_path / "t.db"))
    for i, v in enumerate([1.0, 2.0, 3.0]):
        st.write_samples([Sample("symbol", "BTC/USDT", "funding_rate", v)], f"2026-06-0{1 + i}T00:00:00+00:00")
    st.write_samples([Sample("global", GLOBAL, "fear_greed", 12.0)], "2026-06-07T00:00:00+00:00")

    out = get_metric_history("BTC/USDT", ["funding_rate"], "all", st)
    assert out["window"] == "all"
    fr = out["metrics"]["funding_rate"]
    assert fr["samples"] == 3 and fr["current"] == 3.0 and fr["direction"] == "rising"

    g = get_metric_history(GLOBAL, ["fear_greed"], "30d", st)
    assert g["metrics"]["fear_greed"]["current"] == 12.0


def test_get_metric_history_missing_metric(tmp_path):
    st = MarketStore(str(tmp_path / "t.db"))
    out = get_metric_history("BTC/USDT", ["nope"], "7d", st)
    assert out["metrics"]["nope"] == {"samples": 0}
