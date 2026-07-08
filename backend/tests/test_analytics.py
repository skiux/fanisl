"""时间序列摘要 + get_metric_history 单测（summarize 纯函数；history 用 store 夹具）。"""

from datetime import datetime, timezone

from analyzer.analytics import summarize_series
from analyzer.marketstore import GLOBAL, Sample
from analyzer.tools.history import get_metric_history


def _pts(values, start_h=0):
    return [
        {"ts": f"2026-06-{1 + i:02d}T00:00:00+00:00", "value": v}
        for i, v in enumerate(values)
    ]


def test_summarize_basic_rising():
    # 等距点：末点权重默认按前面间隔均值估计 → 各点等权，与按点计数同结果
    s = summarize_series(_pts([10, 20, 30, 40, 50]))
    assert s["samples"] == 5
    assert s["current"] == 50 and s["first"] == 10
    assert s["min"] == 10 and s["max"] == 50 and s["time_weighted_mean"] == 30
    assert s["direction"] == "rising"
    assert s["time_weighted_percentile"] == 0.8  # 4/5 的时间低于 50
    assert s["change_pct"] == 400.0
    assert len(s["trajectory"]) == 5


def test_summarize_time_weighted():
    # 10 持续 8 天后跳到 90、90 只持续 1 天 → 时长加权分位/均值远不同于按点计数
    pts = [
        {"ts": "2026-06-01T00:00:00+00:00", "value": 10.0},
        {"ts": "2026-06-09T00:00:00+00:00", "value": 90.0},
    ]
    now = datetime(2026, 6, 10, tzinfo=timezone.utc)  # 末点持续到此=1 天
    s = summarize_series(pts, now=now)
    # 低于当前(90)的时间 = 8 天 / 9 天 ≈ 0.889（按点计数会是 0.5）
    assert s["time_weighted_percentile"] == 0.889
    # 加权均值 = (10*8 + 90*1)/9 ≈ 18.89（按点会是 50）
    assert abs(s["time_weighted_mean"] - 170 / 9) < 1e-3
    assert s["span_hours"] == 216.0  # 9 天


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


def test_get_metric_history_reads_store(store):
    # 时间戳相对 now 生成——写死日历日期会随时间老化滑出 30d 窗口(2026-07 踩过)
    from datetime import datetime, timedelta, timezone
    now = datetime.now(tz=timezone.utc)
    st = store
    for i, v in enumerate([1.0, 2.0, 3.0]):
        st.write_samples([Sample("symbol", "BTC/USDT", "funding_rate", v)],
                         (now - timedelta(days=6 - i)).isoformat())
    st.write_samples([Sample("global", GLOBAL, "fear_greed", 12.0)],
                     (now - timedelta(days=1)).isoformat())

    out = get_metric_history("BTC/USDT", ["funding_rate"], "all", st)
    assert out["window"] == "all"
    fr = out["metrics"]["funding_rate"]
    assert fr["samples"] == 3 and fr["current"] == 3.0 and fr["direction"] == "rising"

    g = get_metric_history(GLOBAL, ["fear_greed"], "30d", st)
    assert g["metrics"]["fear_greed"]["current"] == 12.0


def test_get_metric_history_missing_metric(store):
    st = store
    out = get_metric_history("BTC/USDT", ["nope"], "7d", st)
    assert out["metrics"]["nope"] == {"samples": 0}
