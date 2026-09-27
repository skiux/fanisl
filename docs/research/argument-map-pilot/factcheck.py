"""样板的事实核对：作者引用的行情数字 vs 知识库 daily_bars（只读）。"""
import datetime as dt

from fanisl.config import get_settings
from fanisl.db import make_pool

pool = make_pool(get_settings().pg_knowledge_conninfo, min_size=1, max_size=1)
D = dt.date


def close(c, sym, d):
    r = c.execute("SELECT ts::date d, close, low, high FROM daily_bars WHERE symbol=%s AND ts::date<=%s ORDER BY ts DESC LIMIT 1", (sym, d)).fetchone()
    return r


def chg(c, sym, a, b, bp=False):
    x, y = close(c, sym, a), close(c, sym, b)
    if not x or not y:
        return f"{sym}: 无数据"
    if bp:
        return f"{sym}: {x['close']:.3f}({x['d']}) → {y['close']:.3f}({y['d']}) = {(y['close']-x['close'])*100:+.0f}bp"
    return f"{sym}: {x['close']:.2f}({x['d']}) → {y['close']:.2f}({y['d']}) = {(y['close']/x['close']-1)*100:+.1f}%"


def us2y(c, d):
    a, b = close(c, "US10Y", d), close(c, "T10Y2Y", d)
    return a["close"] - b["close"], a["d"], b["d"]


with pool.connection() as c:
    print("== TALK c127：一周（9-11 → 9-18）")
    for s in ("US10Y",):
        print(" ", chg(c, s, D(2026, 9, 11), D(2026, 9, 18), bp=True))
    y0, y1 = us2y(c, D(2026, 9, 11)), us2y(c, D(2026, 9, 18))
    print(f"  US2Y(=US10Y-T10Y2Y): {y0[0]:.3f} → {y1[0]:.3f} = {(y1[0]-y0[0])*100:+.0f}bp")
    for s in ("TLT", "SPX", "NDX", "DJI", "IGV", "BTCUSDT", "XAUUSD", "KBWB", "MAGS", "RSP"):
        print(" ", chg(c, s, D(2026, 9, 11), D(2026, 9, 18)))
    print("== TALK c127：QTD（6-30 → 9-18）")
    print(" ", chg(c, "US10Y", D(2026, 6, 30), D(2026, 9, 18), bp=True))
    y0 = us2y(c, D(2026, 6, 30))
    print(f"  US2Y: {y0[0]:.3f} → {y1[0]:.3f} = {(y1[0]-y0[0])*100:+.0f}bp")
    for s in ("TLT", "WTI", "XAUUSD", "IGV", "BTCUSDT", "XLV", "SOXX", "SOX", "MAGS", "SPX"):
        print(" ", chg(c, s, D(2026, 6, 30), D(2026, 9, 18)))
    print("  SPX YTD(12-31 → 6-30):", chg(c, "SPX", D(2025, 12, 31), D(2026, 6, 30)), "| MAGS:", chg(c, "MAGS", D(2025, 12, 31), D(2026, 6, 30)))
    print("  SOX 6 月底到 9-18 的高低：", c.execute("SELECT max(close) hi, min(close) lo FROM daily_bars WHERE symbol='SOX' AND ts::date BETWEEN '2026-06-20' AND '2026-09-18'").fetchone())
    print("== TALK c127：估值（价格 / 未来一年 EPS 一致预期，EPS 取 9-23 记录的 7 天前值）")
    for s in ("COST", "WMT", "KO", "PG"):
        e = c.execute("SELECT asof, d7, current FROM eps_estimates WHERE symbol=%s AND period='+1y' ORDER BY asof LIMIT 1", (s,)).fetchone()
        p = close(c, s, D(2026, 9, 18))
        if e and p:
            print(f"  {s}: 9-18 收 {p['close']:.2f} / EPS {e['d7']:.3f}（{e['asof']} 记录的 7 天前值）= {p['close']/e['d7']:.2f} 倍")
    rows = c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='COST' AND ts::date<='2026-09-18' ORDER BY ts DESC LIMIT 60").fetchall()[::-1]
    gains = [max(rows[i]['close']-rows[i-1]['close'], 0) for i in range(1, len(rows))]
    losses = [max(rows[i-1]['close']-rows[i]['close'], 0) for i in range(1, len(rows))]
    ag, al = sum(gains[:14])/14, sum(losses[:14])/14
    for g, l in zip(gains[14:], losses[14:]):
        ag, al = (ag*13+g)/14, (al*13+l)/14
    print(f"  COST RSI14（Wilder）9-18：{100-100/(1+ag/al):.1f}")

    print("== Andy c123（9-16 议息）")
    print("  DFEDTARU:", [(r['d'], r['close']) for r in c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='DFEDTARU' AND ts::date BETWEEN '2026-09-14' AND '2026-09-18' ORDER BY ts")])
    for r in c.execute("SELECT ts::date d, open, high, low, close FROM daily_bars WHERE symbol='SPX' AND ts::date BETWEEN '2026-09-14' AND '2026-09-18' ORDER BY ts"):
        print("  SPX", r["d"], "O", r["open"], "H", r["high"], "L", r["low"], "C", r["close"])
    for s in ("SOXX", "CRCL", "XAUUSD", "DXY", "NDX"):
        r = close(c, s, D(2026, 9, 16)); print(f"  {s} {r['d']} 收 {r['close']:.2f} 低 {r['low']:.2f}")
    ry = close(c, "US10Y", D(2026, 9, 16))["close"] - close(c, "T10YIE", D(2026, 9, 16))["close"]
    print(f"  实际利率近似（US10Y - T10YIE）9-16：{ry:.2f}")
    hi = c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='SOXX' AND ts::date<='2026-09-16' ORDER BY close DESC LIMIT 1").fetchone()
    lo = c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='SOXX' AND ts::date BETWEEN %s AND '2026-09-16' ORDER BY close LIMIT 1", (hi['d'],)).fetchone()
    print(f"  SOXX 峰 {hi['d']} {hi['close']:.2f} → 其后最低 {lo['d']} {lo['close']:.2f} = {(lo['close']/hi['close']-1)*100:+.1f}%")
    hi = c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='SOX' AND ts::date<='2026-09-16' ORDER BY close DESC LIMIT 1").fetchone()
    lo = c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='SOX' AND ts::date BETWEEN %s AND '2026-09-16' ORDER BY close LIMIT 1", (hi['d'],)).fetchone()
    print(f"  SOX  峰 {hi['d']} {hi['close']:.2f} → 其后最低 {lo['d']} {lo['close']:.2f} = {(lo['close']/hi['close']-1)*100:+.1f}%")
    print("  WTI:", chg(c, "WTI", D(2026, 6, 30), D(2026, 9, 16)))

    print("== 美投君 c126（录于 8 月，数据截至 8-9）")
    for d in (D(2025, 12, 31), D(2026, 8, 7), D(2026, 9, 18)):
        r = close(c, "VIK", d); print(f"  VIK {r['d']} 收 {r['close']:.2f}（较 IPO 价 24 {(r['close']/24-1)*100:+.0f}%）")
    hi = c.execute("SELECT ts::date d, close FROM daily_bars WHERE symbol='VIK' AND ts::date<='2026-09-18' ORDER BY close DESC LIMIT 1").fetchone()
    print(f"  VIK 最高收盘 {hi['d']} {hi['close']:.2f}（较 IPO {(hi['close']/24-1)*100:+.0f}%）")
    print("  VIK YTD 至 8-07:", chg(c, "VIK", D(2025, 12, 31), D(2026, 8, 7)))
    print("  VIK 7-07 → 8-07:", chg(c, "VIK", D(2026, 7, 7), D(2026, 8, 7)))
pool.close()
