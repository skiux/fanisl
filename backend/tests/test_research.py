"""研究/回测纯函数单测（不联网、不碰库）：point-in-time 助手 + 统计。

回测的有效性命门是"无未来函数"，这些函数必须可单测且行为确定。
"""

from datetime import datetime, timedelta, timezone

from analyzer.research import pit, stats

T0 = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _pts(*vals):
    # (小时偏移, 值) → Point
    return [(T0 + timedelta(hours=h), v) for h, v in vals]


def test_asof_is_point_in_time():
    pts = _pts((0, 1.0), (2, 2.0), (5, 3.0))
    assert pit.asof(pts, T0 - timedelta(hours=1)) is None      # 早于一切
    assert pit.asof(pts, T0) == 1.0                            # 恰在首点
    assert pit.asof(pts, T0 + timedelta(hours=1)) == 1.0       # 持有到下一点
    assert pit.asof(pts, T0 + timedelta(hours=2)) == 2.0
    assert pit.asof(pts, T0 + timedelta(hours=99)) == 3.0      # 末点持续


def test_first_after_strict():
    pts = _pts((0, 1.0), (2, 2.0), (5, 3.0))
    assert pit.first_after(pts, T0)[1] == 2.0                  # 严格之后
    assert pit.first_after(pts, T0 + timedelta(hours=2))[1] == 3.0
    assert pit.first_after(pts, T0 + timedelta(hours=5)) is None


def test_value_at_or_after_tolerance():
    pts = _pts((0, 10.0), (4, 14.0), (10, 20.0))
    # 找 +4h 处的点，容差 90min → 命中 4h 点
    got = pit.value_at_or_after(pts, T0 + timedelta(hours=4), timedelta(minutes=90))
    assert got[1] == 14.0
    # 找 +6h，最近的是 +10h（差 4h）> 容差 → None
    assert pit.value_at_or_after(pts, T0 + timedelta(hours=6), timedelta(minutes=90)) is None


def test_dedup_by_gap():
    times = [T0, T0 + timedelta(hours=3), T0 + timedelta(hours=13), T0 + timedelta(hours=20)]
    kept = pit.dedup_by_gap(times, timedelta(hours=12))
    # 0h 保留；3h 距 0h<12h 丢；13h 距 0h≥12h 保留；20h 距 13h<12h?(7h) 丢
    assert kept == [T0, T0 + timedelta(hours=13)]


def test_tw_percentile_low_value_low_pct():
    # 30 天里大部分时间值=1，最后一点突降到 -5（极低）→ 时间加权分位应很低
    pts = [(T0 + timedelta(days=d), 1.0) for d in range(0, 30)]
    t = T0 + timedelta(days=30)
    pts.append((t, -5.0))
    p = pit.tw_percentile_at(pts, t, timedelta(days=30), min_points=10)
    assert p is not None and p < 0.1            # 当前值低于几乎所有历史
    # 历史不足（回看跨度太短）→ None
    short = _pts((0, 1.0), (1, 1.0), (2, -5.0))
    assert pit.tw_percentile_at(short, T0 + timedelta(hours=2), timedelta(days=30)) is None


def test_stats_mean_hit_bootstrap():
    assert stats.mean([1, 2, 3]) == 2
    assert stats.hit_rate([1, -1, 2, -3]) == 0.5
    lo, hi = stats.bootstrap_ci([0.01] * 50)     # 常数 → CI 收敛到该值
    assert abs(lo - 0.01) < 1e-9 and abs(hi - 0.01) < 1e-9
    lo, hi = stats.bootstrap_ci([0.0, 0.02], n=2000)  # CI 应夹住均值 0.01
    assert lo <= 0.01 <= hi


def test_random_null_upper_separates_signal():
    pool = [0.0] * 100          # 基线全 0
    # 从全 0 池抽样均值恒为 0 → 上分位≈0；真信号均值>它即"非随机"
    upper = stats.random_null_upper(pool, size=30)
    assert abs(upper) < 1e-9


def test_h4_oi_chg_no_lookahead():
    # OI 序列：t-3h=100, t=95（下降 5%）。oi_chg 只能用 ≤t 的点，符号必须为负（去杠杆）。
    from analyzer.research.h4 import _asof_fresh, _oi_chg, OI_TOL
    oi = _pts((0, 100.0), (3, 95.0), (4, 200.0))   # +4h 处暴涨，但绝不能被 oi_chg(t=+3h) 看到
    t = T0 + timedelta(hours=3)
    chg = _oi_chg(oi, t)
    assert chg is not None and abs(chg - (-0.05)) < 1e-9   # (95-100)/100，没看未来的 200
    # 陈旧/缺值：基准点距 t-3h 太远 → None
    sparse = _pts((0, 100.0))                       # 只有 1 个点，t=+3h 处基准(t-3h=0h)在，但当前点也=0h
    assert _asof_fresh(sparse, T0 + timedelta(hours=10), OI_TOL) is None  # 距 10h 远超容差
    # 基准为 0 → None（不能除）
    zero = _pts((0, 0.0), (3, 50.0))
    assert _oi_chg(zero, T0 + timedelta(hours=3)) is None


def test_h7_trail_no_lookahead():
    # 过去 7d 收益只能用 ≤t 的价：t=+7d 处 = price(t)/price(t-7d)-1，绝不看 t 之后
    from analyzer.research import h7
    pts = [(T0 + timedelta(days=d), 100.0 + d) for d in range(0, 9)]  # 每天 +1
    t = T0 + timedelta(days=7)            # price=107
    r = h7._trail(pts, t)                 # base = t-7d = T0(100) → 107/100-1
    assert r is not None and abs(r - 0.07) < 1e-9
    # 基准点缺失（无 t-7d 附近的价）→ None
    assert h7._trail([(T0, 100.0), (T0 + timedelta(days=7), 107.0)][1:], t) is None


def test_cot_publish_ts_no_lookahead():
    # COT report 周二 as-of → 入库必须偏移到周五发布时刻（+3天 21:00 UTC），否则 3 天未来函数
    from analyzer.research.backfill_cot import _publish_ts
    ts = _publish_ts("2026-06-09")              # 2026-06-09 是周二
    parsed = datetime.fromisoformat(ts)
    assert parsed.year == 2026 and parsed.month == 6 and parsed.day == 12   # 周五
    assert parsed.hour == 21 and parsed.tzinfo is not None


def test_h8_pnl_direction():
    from analyzer.research.h8 import _pnl, COST
    # 进场=信号后首根(+1d,100)，出场+28d(110，+10%)
    price = [(T0, 99.0), (T0 + timedelta(days=1), 100.0), (T0 + timedelta(days=29), 110.0)]
    long_pnl = _pnl(price, T0, "long", 28)
    short_pnl = _pnl(price, T0, "short", 28)
    assert abs(long_pnl - (0.10 - COST)) < 1e-9
    assert abs(short_pnl - (-0.10 - COST)) < 1e-9


def test_h9_drift_pnl_market_neutral():
    # 市场中性：个股 +10%、SPY +2% → 相对 +8%。long 取 +0.08−COST，short 取 −0.08−COST
    from datetime import date
    from analyzer.research.h9 import _drift_pnl, COST
    d0, d1 = date(2026, 1, 5), date(2026, 1, 6)
    px = [(datetime(2026, 1, 5, tzinfo=timezone.utc), 100.0),
          (datetime(2026, 1, 6, tzinfo=timezone.utc), 110.0)]
    spy = {d0: 100.0, d1: 102.0}
    assert abs(_drift_pnl(px, spy, 0, "long", 1) - (0.08 - COST)) < 1e-9
    assert abs(_drift_pnl(px, spy, 0, "short", 1) - (-0.08 - COST)) < 1e-9


def test_spearman_and_pvalue():
    assert abs(stats.spearman([1, 2, 3, 4], [1, 2, 3, 4]) - 1.0) < 1e-9   # 完全正相关
    assert abs(stats.spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1.0) < 1e-9   # 完全负相关
    # 单调非线性仍秩相关=1（Spearman 的意义）
    assert abs(stats.spearman([1, 2, 3, 4], [1, 4, 9, 16]) - 1.0) < 1e-9
    # 强相关 p 小，n 越大越小
    assert stats.corr_pvalue(0.9, 50) < 0.001
    assert stats.corr_pvalue(0.05, 50) > 0.5      # 弱相关不显著


def test_ranks_handles_ties():
    # 并列取平均秩：两个并列的 10 占第 2、3 位 → 平均秩 2.5
    assert stats.ranks([5, 10, 10, 20]) == [1.0, 2.5, 2.5, 4.0]


def test_bh_fdr():
    # 一个极显著 + 一堆噪声 → 至少最显著的过；全噪声 → 全不过
    flags = stats.bh_fdr([0.001, 0.4, 0.5, 0.6, 0.9], q=0.10)
    assert flags[0] is True and not any(flags[1:])
    assert stats.bh_fdr([0.4, 0.5, 0.6], q=0.10) == [False, False, False]
    # nan 跳过、不报显著
    assert stats.bh_fdr([float("nan"), 0.9])[0] is False


def test_h5_breakout_detection():
    # 构造：先 30h 横盘=100，第 31h 跳到 110（创新高=long），之后回落不再触发
    from analyzer.research import h5
    # 50h 横盘=100（满足 MIN_BARS=24 且跨度≥0.8·48h），第 50h 跳到 110（创新高=long）
    pts = [(T0 + timedelta(hours=h), 100.0) for h in range(50)]
    pts.append((T0 + timedelta(hours=50), 110.0))   # 突破
    pts += [(T0 + timedelta(hours=h), 105.0) for h in range(51, 60)]  # 回落，不破新高
    trig = h5._breakouts(pts)
    assert len(trig) == 1 and trig[0][1] == "long"
    assert trig[0][0] == T0 + timedelta(hours=50)
    # 历史不足（<MIN_BARS / 跨度不够）不触发：只有几根就跳高
    short = [(T0 + timedelta(hours=h), 100.0) for h in range(5)] + [(T0 + timedelta(hours=5), 200.0)]
    assert h5._breakouts(short) == []


def test_h3_pnl_direction_sign():
    # 价格 +1h 进场=100，+5h 出场=110（涨 10%）；fade 方向 sign 不能写反
    from analyzer.research.h3 import _pnl, COST
    price = [(T0, 100.0), (T0 + timedelta(hours=1), 100.0), (T0 + timedelta(hours=5), 110.0)]
    long_pnl = _pnl(price, T0, "long", 4)      # 进场=first_after(T0)=+1h(100)，出场+4h=+5h(110)
    short_pnl = _pnl(price, T0, "short", 4)
    assert abs(long_pnl - (0.10 - COST)) < 1e-9     # 做多涨10% 减成本
    assert abs(short_pnl - (-0.10 - COST)) < 1e-9   # 做空亏
