"""H15 回测：小盘 SUE-PEAD 用 **IWM(罗素2000)对冲**——修正 H14 的 size 因子污染。

H14 用 SPY(大盘)对冲小盘 → 残留 size 因子（小盘 vs 大盘），2019-2026 小盘跑输把结果拖成负。
H15 唯一改动 = 基准 SPY→IWM（小盘指数），正确对冲掉小盘市场，留下纯个股 PEAD。其余全沿用 H13/H14。
预注册见 doc/phase3-H15-smallcap-sue-iwm-prereg.md。跑：`python -m analyzer.research.h15`
"""

from __future__ import annotations

from analyzer.config import get_settings
from analyzer.db import make_pool
from . import stats
from .backfill_equity import SMALLCAP
from .h12 import _bucket_means, _frac_pos, _null_upper
from .h13 import COST, PRIMARY, SPLIT, collect

BENCH = "IWM"


def run(pool) -> dict:
    ins = collect(pool, (None, SPLIT), SMALLCAP, bench=BENCH)
    hold = collect(pool, (SPLIT, None), SMALLCAP, bench=BENCH)
    im, hm = _bucket_means(ins), _bucket_means(hold)
    p = {
        "n_buckets": len(im), "n_events": sum(len(v) for v in ins.values()),
        "grand": stats.mean(im), "ci": stats.bootstrap_ci(im) if im else (float("nan"),) * 2,
        "null_upper": _null_upper(ins), "frac_pos": _frac_pos(im),
        "hold_buckets": len(hm), "hold_grand": stats.mean(hm),
        "hold_ci": stats.bootstrap_ci(hm) if hm else (float("nan"),) * 2,
        "hold_null": _null_upper(hold), "hold_frac": _frac_pos(hm),
        "n_events_hold": sum(len(v) for v in hold.values()),
    }
    p["verdict"] = _verdict(p)
    return p


def _verdict(p: dict) -> dict:
    if p["n_buckets"] < 20:
        return {"label": "功效不足", "reason": f"in-sample 桶 {p['n_buckets']} < 20"}
    hold_indep = (p["hold_buckets"] >= 12 and p["hold_grand"] > 0
                  and p["hold_grand"] > p["hold_null"])
    checks = {
        "②grand>0且CI下限>0": p["grand"] > 0 and p["ci"][0] > 0,
        "③超随机符号零分布": p["grand"] > p["null_upper"],
        "④>50%桶为正": p["frac_pos"] > 0.5,
        "⑤holdout 独立显著": hold_indep,
    }
    if all(checks.values()):
        label = "有戏（IWM 对冲后小盘 SUE-PEAD 跨 regime 独立成立）→ Phase 4 ★首个可部署候选"
    elif p["grand"] > 0 and not checks["⑤holdout 独立显著"]:
        label = "in-sample 正但 holdout 仍不独立 → KILLED（PEAD 整体衰减）"
    elif p["grand"] <= 0:
        label = "无 edge（IWM 对冲后仍非正 → H14 的负非 size 污染，小盘 PEAD 真不成立）→ KILLED"
    else:
        label = "无 edge → KILLED"
    return {"label": label, "checks": checks}


def _f(x, d=4):
    return "—" if x is None or (isinstance(x, float) and x != x) else f"{x:.{d}f}"


def main() -> None:
    pool = make_pool(get_settings().pg_conninfo)
    try:
        p = run(pool)
        print("=" * 80)
        print(f"H15：小盘 SUE-PEAD（{len(SMALLCAP)}股池，IWM 对冲，季度桶，+{PRIMARY}日）")
        print("=" * 80)
        print(f"  [IN-SAMPLE <2019] 事件 {p['n_events']}  桶 {p['n_buckets']}  grand={_f(p['grand'])}（扣{COST*1e4:.0f}bps）")
        print(f"      CI=[{_f(p['ci'][0])},{_f(p['ci'][1])}]  随机符号上限={_f(p['null_upper'])}  >0桶={_f(p['frac_pos'],2)}")
        print(f"  [HOLDOUT ≥2019] 事件 {p['n_events_hold']}  桶 {p['hold_buckets']}  grand={_f(p['hold_grand'])}")
        print(f"      CI=[{_f(p['hold_ci'][0])},{_f(p['hold_ci'][1])}]  随机符号上限={_f(p['hold_null'])}  >0桶={_f(p['hold_frac'],2)}")
        print("-" * 80)
        v = p["verdict"]
        if "checks" in v:
            print(f"  [{'PASS' if p['n_buckets']>=20 else 'FAIL'}] ①in-sample 桶≥20")
            for k, ok in v["checks"].items():
                print(f"  [{'PASS' if ok else 'FAIL'}] {k}")
        print(f"\n  裁决：{v['label']}")
        if "reason" in v:
            print(f"        {v['reason']}")
        print("=" * 80)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
