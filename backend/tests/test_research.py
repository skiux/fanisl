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


def test_h17_gate_and_pnl_pit():
    from analyzer.research.h17 import _daily_closes, _sma_pit, _long_pnl, COST
    # 重采样:同一天多点取最晚
    pts = [(T0, 1.0), (T0 + timedelta(hours=3), 2.0), (T0 + timedelta(days=1), 3.0)]
    d = _daily_closes(pts)
    assert len(d) == 2 and d[0][1] == 2.0 and d[1][1] == 3.0
    # SMA point-in-time:只用 ≤j 的收盘;历史不足(<SMA_MIN)返回 None
    closes = [100.0] * 160
    assert _sma_pit(closes, 159) == 100.0
    assert _sma_pit(closes, 100) is None          # 只有 101 个 < 150
    # PnL:进场 i、持有 3 bar、扣成本;越界返回 None
    c = [100.0, 100.0, 100.0, 100.0, 110.0]
    assert abs(_long_pnl(c, 1, 3) - (0.10 - COST)) < 1e-9
    assert _long_pnl(c, 3, 3) is None


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


# --- H18：EIA 库存 surprise 事件研究 ----------------------------------------

def test_eia_publish_ts_wednesday_et_with_dst():
    # period 周五 → 次周三 10:30 ET；夏令 = 14:30Z，冬令 = 15:30Z（DST 由 zoneinfo 处理）
    from analyzer.research.backfill_eia import _publish_ts
    summer = datetime.fromisoformat(_publish_ts("2026-06-26"))   # 夏令
    assert (summer.year, summer.month, summer.day) == (2026, 7, 1)   # 周三
    assert summer.utcoffset() == timedelta(0) and (summer.hour, summer.minute) == (14, 30)
    winter = datetime.fromisoformat(_publish_ts("2026-01-02"))   # 冬令
    assert (winter.year, winter.month, winter.day) == (2026, 1, 7)   # 周三
    assert (winter.hour, winter.minute) == (15, 30)


def test_h18_entry_strictly_after_publish():
    # 无未来函数：进场必须是发布 ts 之后严格第一根日线（周三行在发布前=当日凌晨戳，不得用）
    from analyzer.research.h18 import event_pnl, COST
    pub = datetime(2026, 7, 1, 14, 30, tzinfo=timezone.utc)      # 周三 10:30 ET
    price = [
        (datetime(2026, 7, 1, tzinfo=timezone.utc), 90.0),       # 周三 00:00Z 行：发布前，禁用
        (datetime(2026, 7, 2, tzinfo=timezone.utc), 100.0),      # 周四：进场
        (datetime(2026, 7, 3, tzinfo=timezone.utc), 101.0),
        (datetime(2026, 7, 6, tzinfo=timezone.utc), 102.0),
        (datetime(2026, 7, 7, tzinfo=timezone.utc), 110.0),      # +3 交易日：出场
    ]
    long_pnl = event_pnl(price, pub, "long", 3)
    assert abs(long_pnl - (0.10 - COST)) < 1e-9                  # 100→110，绝不是 90 进场
    assert event_pnl(price, pub, "short", 3) < 0
    # 序列尾部不足 h 行 → None（不硬凑出场价）
    assert event_pnl(price, pub, "long", 4) is None


def test_h18_seasonal_z_uses_prior_years_only():
    # 季节期望只用过去年份的同周样本：当年值再极端也不污染自己的期望
    from datetime import date
    from analyzer.research.h18 import seasonal_z
    events = []
    for yr in range(2019, 2025):                                 # 6 年历史，每年第 10/11 周
        for wk, dv in ((10, 1000.0), (11, 1000.0)):
            d = date.fromisocalendar(yr, wk, 5)
            events.append((datetime(yr, d.month, d.day, tzinfo=timezone.utc), d, dv))
    d_cur = date.fromisocalendar(2025, 10, 5)
    events.append((datetime(2025, 3, 7, tzinfo=timezone.utc), d_cur, 9000.0))  # 当年爆表
    events.sort(key=lambda e: e[1])
    z = seasonal_z(events, len(events) - 1)
    # 期望=1000（只来自 2020-2024 同周样本），σ 极小但样本同值 → σ=0 → None；改造样本给出方差
    assert z is None
    events2 = [e for e in events[:-1]]
    events2[2] = (events2[2][0], events2[2][1], 1100.0)          # 2020 年样本（5 年窗内）制造方差
    events2.append(events[-1])
    z2 = seasonal_z(events2, len(events2) - 1)
    assert z2 is not None and z2 > 3                             # 9000 远超 ~1000 的季节期望
    # 反向核对：2019 年样本在 5 年窗（2020-2024）之外，改爆它不得影响 z
    events3 = [e for e in events2[:-1]]
    events3[0] = (events3[0][0], events3[0][1], 99999.0)
    events3.append(events[-1])
    z3 = seasonal_z(events3, len(events3) - 1)
    assert z3 is not None and abs(z3 - z2) < 1e-9


def test_h18_build_events_drops_gaps():
    # 相邻 period 间隔 >10 天（早年缺口）→ 该 Δ 不是标准周变动，丢弃
    from analyzer.research.h18 import build_events, PUB_LAG
    def pub(period_iso):
        return datetime.fromisoformat(period_iso).replace(tzinfo=timezone.utc) + PUB_LAG
    series = [
        (pub("1982-08-20"), 338764.0),
        (pub("1982-08-27"), 336138.0),   # 正常周 Δ=-2626
        (pub("1982-09-24"), 335586.0),   # 与上一条隔 4 周 → 丢弃
        (pub("1982-10-01"), 334786.0),   # 正常周 Δ=-800
    ]
    ev = build_events(series)
    assert len(ev) == 2
    assert abs(ev[0][2] - (-2626.0)) < 1e-9 and abs(ev[1][2] - (-800.0)) < 1e-9


# --- H19：EIA 盘中版（1h 粒度 + 假期顺延调整）--------------------------------

def test_h19_federal_holidays_observed():
    from datetime import date
    from analyzer.research.h19 import federal_holidays
    h26 = federal_holidays(2026)
    assert date(2026, 7, 3) in h26          # 2026-07-04 周六 → observed 周五 7/3
    assert date(2026, 1, 19) in h26         # MLK：1 月第 3 个周一
    assert date(2026, 11, 26) in h26        # 感恩节：11 月第 4 个周四
    assert date(2026, 6, 19) in h26         # 六月节（2021+）
    assert date(2020, 6, 19) not in federal_holidays(2020)   # 2021 前无六月节


def test_h19_adjusted_publish_holiday_shift():
    # 实证锚点：2026-07-03 period（7/4 observed 周五在报告周内）→ 实际周四 2026-07-09 发布
    from analyzer.research.backfill_eia import _publish_ts
    from analyzer.research.h19 import adjusted_publish
    adj = adjusted_publish(datetime.fromisoformat(_publish_ts("2026-07-03")))
    assert (adj.year, adj.month, adj.day) == (2026, 7, 9)        # 周四
    assert (adj.hour, adj.minute) == (15, 0)                     # 11:00 ET 夏令 = 15:00Z
    # MLK 落在发布周周一 → 顺延周四
    adj2 = adjusted_publish(datetime.fromisoformat(_publish_ts("2026-01-16")))
    assert (adj2.year, adj2.month, adj2.day) == (2026, 1, 22)    # 周四
    assert (adj2.hour, adj2.minute) == (16, 0)                   # 11:00 ET 冬令 = 16:00Z
    # 正常周不动
    adj3 = adjusted_publish(datetime.fromisoformat(_publish_ts("2026-06-26")))
    assert (adj3.month, adj3.day, adj3.hour) == (7, 1, 14)       # 周三 10:30 ET 原样


def test_h19_intraday_entry_and_horizon():
    from analyzer.research.h19 import intraday_ret
    pub = datetime(2026, 7, 1, 14, 30, tzinfo=timezone.utc)
    hourly = [(datetime(2026, 7, 1, 13, 0, tzinfo=timezone.utc) + timedelta(hours=k), 100.0 + k)
              for k in range(12)]
    # 发布 14:30 → 第一根收盘 >14:30 是 15:00 那根（idx2,102），+8 根 = 23:00（110）
    r = intraday_ret(hourly, pub, 8)
    assert abs(r - (110.0 / 102.0 - 1.0)) < 1e-9
    # 进场距发布 >3h（数据洞）→ None
    sparse = [(datetime(2026, 7, 1, 19, 0, tzinfo=timezone.utc), 100.0),
              (datetime(2026, 7, 2, 3, 0, tzinfo=timezone.utc), 101.0)]
    assert intraday_ret(sparse, pub, 1) is None
    # 尾部不足 h 根 → None
    assert intraday_ret(hourly, pub, 20) is None


# --- H20：横截面资金费 carry --------------------------------------------------

def test_h20_assign_legs_by_funding():
    from analyzer.research.h20 import assign_legs
    f = {f"S{i}": v for i, v in enumerate([-0.30, -0.10, -0.05, 0.0, 0.01, 0.02,
                                           0.03, 0.04, 0.05, 0.06, 0.10, 0.20,
                                           -0.20, 0.30, -0.02, 0.15])}
    longs, shorts = assign_legs(f, k=3)
    assert set(longs) == {"S0", "S12", "S1"}      # 最负 3 名
    assert set(shorts) == {"S13", "S11", "S15"}   # 最正 3 名


def test_h20_week_spread_carry_signs_and_cost():
    from analyzer.research.h20 import week_spread, COST_SPREAD
    # long 名：价 +2%、费率负（carry_frac=-0.001）→ long 收 +0.001
    # short 名：价 -1%、费率正（carry_frac=+0.002）→ short 收 +0.002，价再赚 +1%
    pn = {"L": (0.02, -0.001), "S": (-0.01, 0.002)}
    got = week_spread(pn, ["L"], ["S"])
    want = (0.02 + 0.001) + (0.01 + 0.002) - COST_SPREAD
    assert abs(got - want) < 1e-12
    # 反向核对：两腿费率都对我方不利时 carry 变成支出
    pn2 = {"L": (0.02, +0.001), "S": (-0.01, -0.002)}
    got2 = week_spread(pn2, ["L"], ["S"])
    want2 = (0.02 - 0.001) + (0.01 - 0.002) - COST_SPREAD
    assert abs(got2 - want2) < 1e-12


def test_h20_carry_sum_window_and_units():
    from analyzer.research.h20 import carry_sum
    t0 = T0
    fund = [(T0, 0.10), (T0 + timedelta(days=1), 0.10),      # 0.10%/8h × 3 = 0.003/天
            (T0 + timedelta(days=7), -0.20),
            (T0 + timedelta(days=8), 9.9)]                    # 窗外，不得计入
    got = carry_sum(fund, t0, t0 + timedelta(days=7))         # (t0, t0+7] 含 d1 与 d7
    assert abs(got - (0.10 * 3 / 100 + (-0.20) * 3 / 100)) < 1e-12


def test_h20_universe_week_validity(pool):
    # 集成：造 16 个标的的最小数据 → 恰好成周；缺价格的标的被剔除后 <16 → 跳周
    from analyzer.research import h20
    from analyzer.marketstore import MarketStore
    store = MarketStore(pool)
    with pool.connection() as conn:
        conn.execute("DELETE FROM metric_samples WHERE metric IN ('funding_rate_1d')"
                     " OR (metric='price' AND symbol LIKE 'TT%/USDT')")
    t0 = h20.ANCHOR
    rows = []
    for i in range(16):
        sym = f"TT{i}/USDT"
        f = (i - 8) / 100.0
        for d in range(0, 9):
            ts = (t0 + timedelta(days=d)).isoformat()
            rows.append(("symbol", sym, "funding_rate_1d", ts, f))
            # 价格：全部横盘 100（spread 应≈ 纯 carry − 成本）
            rows.append(("symbol", sym, "price", ts, 100.0))
    store.write_history(rows)
    weeks = h20.build_weeks(pool)
    target = [w for w in weeks if w["t"] == t0]
    assert len(target) == 1 and len(target[0]["pn"]) == 16
    # 把 1 个标的的价格删掉 → 有效 15 < MIN_VALID → 该周消失
    with pool.connection() as conn:
        conn.execute("DELETE FROM metric_samples WHERE symbol='TT0/USDT' AND metric='price'")
    weeks2 = h20.build_weeks(pool)
    assert not [w for w in weeks2 if w["t"] == t0]
    with pool.connection() as conn:  # 清理，防污染其他用例
        conn.execute("DELETE FROM metric_samples WHERE symbol LIKE 'TT%/USDT'")
