"""K4 评分器：按提取时冻结的 ScoringSpec 机械评分（零 LLM）。

统一口径（v1）：
- ref = 单元的 ref_price_at_publish（提取时的屏价），缺失回填发布日（或此前最近交易日）收盘；
- eval_ladder 的每个日期 L 独立评分；仅当该符号行情已覆盖到 L（max_ts≥L）才评（到期评）；
- touch/range/守护窗口 = [发布日次日, L]；条件成立日 c 之后的主体窗口 = [c 次日, L]；
- 标准语义之外的条款读 scoring_overrides.json（success_def 的机械化编译，语义仲裁=success_def）；
- outcome: hit / miss / partial / condition_not_met / condition_unverifiable / unpriceable。

用法：python -m analyzer.knowledge.scorers [--dry-run]（幂等：同 (unit, 时点, 版本) 已评则跳过）
"""

from __future__ import annotations

import datetime as dt
import json
import operator
import pathlib
import sys

from ..config import get_settings
from ..db import make_pool
from .prices import SYMBOL_MAP, FRED_SERIES, PriceStore

SCORER_VERSION = "v1"
# close_at_eval 的比较符。阶梯函数标的（如 DFEDTARU）用严格号才不会把"没变"读成
# "发生了"，而"维持在低位"这类判断要的是 <=，用 < 等于要求再创新低。
# "==" 只对阶梯/离散序列有意义（如"今年不加不降"），连续价格序列上恒为假，勿用。
_CMP = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le,
        "==": operator.eq}
OVERRIDES = json.loads(
    (pathlib.Path(__file__).parent / "scoring_overrides.json").read_text())


def _bars(ps: PriceStore, sym: str, start: dt.date, end: dt.date) -> list[dict]:
    return ps.window(sym, start, end)


def _pub_close(ps: PriceStore, sym: str, pub: dt.date) -> float | None:
    row = ps.close_on_or_before(sym, pub)
    return row[1] if row else None


def _resolve_condition(ps: PriceStore, cond: dict, own_sym: str, pub: dt.date,
                       until: dt.date) -> tuple[dt.date | None, str | None]:
    """在 [pub+1, until] 内找条件成立日。返回 (成立日|None, 失败态|None)。"""
    sym = cond.get("symbol", own_sym)
    bars = _bars(ps, sym, pub + dt.timedelta(days=1), until)
    if not bars:
        return None, "condition_not_met"
    t = cond["type"]
    if t == "guard_hold":  # 持续守护：任一收盘破位=条件失败；否则视为始终成立（成立日=起点）
        for b in bars:
            if b["close"] < cond["level"]:
                return None, "condition_not_met"
        return bars[0]["ts"], None
    if t == "breakout_retest":  # 收盘突破后回踩不破 retest_floor；破=确认失败
        c1 = next((b["ts"] for b in bars if b["close"] > cond["breakout_close"]), None)
        if c1 is None:
            return None, "condition_not_met"
        if any(b["low"] < cond["retest_floor"] for b in bars if b["ts"] > c1):
            return None, "condition_not_met"
        return c1, None
    for b in bars:
        if t == "close_below" and b["close"] < cond["level"]:
            return b["ts"], None
        if t == "close_above" and b["close"] > cond["level"]:
            return b["ts"], None
        if t == "close_above_eq" and b["close"] >= cond["level"]:
            return b["ts"], None
        if t == "touch_below" and b["low"] <= cond["level"]:
            return b["ts"], None
        # 形成阻力：当日触及该位但收盘没站上（unit 302 的 success_def 需要，2026-08 新增）
        if t == "touch_above_close_below" and b["high"] >= cond["level"] and b["close"] < cond["level"]:
            return b["ts"], None
        if t == "dip_hold" and b["low"] <= cond["touch_below"] and b["close"] >= cond["close_at_least"]:
            return b["ts"], None
    return None, "condition_not_met"


def _score_sign(direction: str, eval_close: float, ref: float, ov: dict) -> str:
    factor, band = ov.get("ref_factor", 1.0), ov.get("band", 0.02)
    if ov.get("op") == ">=":
        return "hit" if eval_close >= ref * factor else "miss"
    if direction == "up":
        return "hit" if eval_close >= ref * factor else "miss"
    if direction == "down":
        return "hit" if eval_close < ref * factor else "miss"
    return "hit" if abs(eval_close / ref - 1) <= band else "miss"  # flat：±band


def _score_range(bars: list[dict], low, high, floor, bounds: str) -> str:
    if bounds == "low_only":
        if floor is not None and any(b["close"] < floor for b in bars):
            return "miss"
        if any(b["close"] < low for b in bars):
            return "partial" if floor is not None else "miss"
        return "partial" if any(b["low"] < low for b in bars) else "hit"
    if bounds == "high_only":
        if any(b["close"] > high for b in bars):
            return "miss"
        return "partial" if any(b["high"] > high for b in bars) else "hit"
    # both
    if any(b["close"] < low or b["close"] > high for b in bars):
        return "miss"
    if any(b["low"] < low or b["high"] > high for b in bars):
        return "partial"
    return "hit"


def score_unit_at(ps: PriceStore, unit: dict, ladder_date: dt.date) -> tuple[str, dict] | None:
    """对单元在一个阶梯时点评分。未到期返回 None；否则 (outcome, realized)。"""
    p = unit["payload"]
    spec, ov = p["scoring_spec"], OVERRIDES.get(str(unit["id"]), {})
    ov = {**ov, **ov.get("per_ladder", {}).get(str(ladder_date), {})}
    if ov.get("manual"):
        return "condition_unverifiable", {"note": ov["manual"]}
    method, direction = spec["method"], p.get("direction")
    pub: dt.date = unit["published_at"].date()
    sym = p.get("asset_symbol")
    realized: dict = {"ladder": str(ladder_date)}

    # 组合（relative 专用）与常规符号的可评性
    basket = ov.get("basket")
    syms = basket or ([sym] if sym else [])
    if not syms or any(s not in SYMBOL_MAP and s not in FRED_SERIES for s in syms):
        return "unpriceable", {"note": f"无符号映射: {syms}"}
    last = {s: ps.close_on_or_before(s, dt.date(2100, 1, 1)) for s in syms}
    if any(v is None or v[0] < ladder_date for v in last.values()):
        return None  # 行情未覆盖到 L=未到期

    # ref 只认单元上冻结的那个；没冻结才回查发布日收盘，并在 realized 里标出来是回查的。
    # 回查值必须由调用方固化回单元（见 run()）——否则同一条 claim 的 +7/+30/+90 三个时点
    # 可能各自查到不同的 ref：yfinance 返回的是复权价，标的一旦拆股，历史行情整体改写。
    ref = unit.get("ref_price_at_publish")
    if ref is None:
        ref = _pub_close(ps, syms[0], pub)
        realized["ref_backfilled"] = True
    if ov.get("baseline_date"):
        base = ps.close_on_or_before(syms[0], dt.date.fromisoformat(ov["baseline_date"]))
        if base is None:
            return "unpriceable", {"note": "基准日无行情"}
        ref = base[1]
    if ref is None:
        return "unpriceable", {"note": "无参考价"}
    realized["ref"] = round(float(ref), 4)

    # 前置条件（own 或他符号）；成立后窗口起点后移
    win_start = pub + dt.timedelta(days=1)
    if ov.get("condition"):
        c_date, fail = _resolve_condition(ps, ov["condition"], sym, pub, ladder_date)
        if fail:
            return fail, realized
        realized["cond_date"] = str(c_date)
        if ov.get("vs") == "condition_close":
            ref = _pub_close(ps, sym, c_date)
            realized["ref"] = round(float(ref), 4)
        if ov["condition"]["type"] != "guard_hold":
            if c_date >= ladder_date and ov.get("mode") != "touch" and method != "range_hold":
                return "condition_not_met", realized
            win_start = c_date + dt.timedelta(days=1)

    eval_row = ps.close_on_or_before(syms[0], ladder_date)
    eval_close = eval_row[1]
    realized["eval_close"] = round(float(eval_close), 4)
    bars = _bars(ps, syms[0], win_start, ladder_date)
    mag = p.get("magnitude") or {}

    # override 模式优先
    mode = ov.get("mode")
    if mode == "close_at_eval":
        ok = _CMP[ov["op"]](eval_close, ov["level"])
        return ("hit" if ok else "miss"), realized
    if mode == "touch":
        touched = any(b["low"] <= ov["touch_level"] for b in bars)
        return ("hit" if touched else "miss"), realized
    if mode == "max_drawdown_lt":
        dd = min((b["close"] / ref - 1 for b in bars), default=0.0)
        realized["max_dd"] = round(dd, 4)
        return ("miss" if dd <= -ov["pct"] / 100 else "hit"), realized

    if method == "sign":
        return _score_sign(direction, eval_close, ref, ov), realized

    if method == "target_touch":
        t = mag["target"]
        if direction == "down":
            touched = any(b["low"] <= t for b in bars)
        else:
            touched = any(b["high"] >= t for b in bars)
        return ("hit" if touched else "miss"), realized

    if method == "target_close":
        t = mag["target"]
        dev = abs(eval_close - t) / t
        if dev <= 0.02:
            return "hit", realized
        right_dir = eval_close > ref if direction == "up" else eval_close < ref
        return ("partial" if right_dir and dev <= 0.05 else "miss"), realized

    if method == "range_hold":
        low, high, floor = mag.get("low"), ov.get("level_high", mag.get("high")), ov.get("floor")
        if ov.get("high_from_pub_plus") is not None:
            high, low = _pub_close(ps, syms[0], pub) + ov["high_from_pub_plus"], None
        bounds = ov.get("bounds") or ("low_only" if low is not None and high is None
                                      else "high_only" if high is not None and low is None else None)
        if bounds is None:
            raise ValueError(f"unit {unit['id']}: 双边 magnitude 需显式 bounds override")
        return _score_range(bars, low, high, floor, bounds), realized

    if method == "relative_return":
        bench = spec["benchmark"]
        def ret(s: str) -> float | None:
            p0 = _pub_close(ps, s, pub)
            p1 = ps.close_on_or_before(s, ladder_date)
            return None if (p0 is None or p1 is None) else p1[1] / p0 - 1
        rs = [ret(s) for s in syms]
        rb = ret(bench)
        if any(r is None for r in rs) or rb is None:
            return "unpriceable", {"note": "相对收益腿缺行情"}
        ra = sum(rs) / len(rs)
        diff, margin = ra - rb, ov.get("margin", 0.0)
        realized.update({"asset_ret": round(ra, 4), "bench_ret": round(rb, 4)})
        if direction == "down":
            return ("hit" if diff < margin else "miss"), realized
        if direction == "up":
            return ("hit" if diff > margin else "miss"), realized
        return ("hit" if diff >= margin else "miss"), realized  # flat

    raise ValueError(f"未知 method: {method}")


def run(*, dry: bool) -> None:
    from .store import ACTIVE_RUN, KnowledgeStore
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        store, ps = KnowledgeStore(pool), PriceStore(pool)
        with pool.connection() as conn:
            units = conn.execute(
                f"SELECT u.* FROM knowledge_units u WHERE u.kind='claim' "
                f"AND u.payload->>'verifiability' IN ('A','B','C') AND {ACTIVE_RUN} "
                f"ORDER BY u.id").fetchall()
        n_new = n_skip = n_pending = 0
        counts: dict[str, int] = {}
        for u in units:
            for lad in u["payload"]["scoring_spec"]["eval_ladder"]:
                lad_d = dt.date.fromisoformat(lad)
                if store.score_exists(u["id"], lad, SCORER_VERSION):
                    n_skip += 1
                    continue
                res = score_unit_at(ps, u, lad_d)
                if res is None:
                    n_pending += 1
                    continue
                outcome, realized = res
                # 首次回查出来的 ref 立刻固化到单元上：PIT 锚点不能每次评分现查，否则
                # 拆股复权一改，同一条 claim 的不同阶梯时点会各自对着不同的参考价。
                if realized.pop("ref_backfilled", False) and realized.get("ref") is not None:
                    if not dry:
                        store.freeze_ref_price(u["id"], realized["ref"])
                    u["ref_price_at_publish"] = realized["ref"]
                counts[outcome] = counts.get(outcome, 0) + 1
                print(f"  #{u['id']:<4} {u['payload'].get('asset_symbol') or 'basket':8s} "
                      f"{u['payload']['scoring_spec']['method']:15s} @{lad}  {outcome:22s} {realized}", flush=True)
                if not dry:
                    store.record_score(u["id"], eval_ts=dt.datetime.now(dt.timezone.utc),
                                       horizon_label=lad, outcome=outcome, realized=realized,
                                       scorer_version=SCORER_VERSION)
                    n_new += 1
        print(f"\n{'dry-run：' if dry else ''}新评 {sum(counts.values())}（{counts}）"
              f"，已存在跳过 {n_skip}，未到期 {n_pending}")
    finally:
        pool.close()


def freeze_refs(*, dry: bool = True) -> dict:
    """给还空着 ref_price_at_publish 的可定价 claim 补上发布日收盘并钉死。

    顺带体检：把补进去的值和该单元**已有评分**里记下的 ref 对一遍——两者不一致就说明
    行情序列在评分之后被改写过（拆股复权是最常见的原因），那些历史评分是对着一个
    已经不存在的参考价算的。带 baseline_date / vs=condition_close 这两类 override 的
    单元跳过对账：它们的 realized.ref 本来就不是发布日收盘。
    """
    from .store import ACTIVE_RUN, KnowledgeStore

    pool = make_pool(get_settings().pg_knowledge_conninfo)
    stat = {"missing": 0, "frozen": 0, "no_bar": 0, "drifted": []}
    try:
        store, ps = KnowledgeStore(pool), PriceStore(pool)
        with pool.connection() as conn:
            rows = conn.execute(f"""
                SELECT u.id, u.published_at, u.payload,
                       (SELECT s.realized->>'ref' FROM claim_scores s
                        WHERE s.unit_id=u.id ORDER BY s.horizon_label LIMIT 1) AS scored_ref
                FROM knowledge_units u
                WHERE u.kind='claim' AND (u.payload->>'priceable')::bool
                  AND u.ref_price_at_publish IS NULL AND {ACTIVE_RUN}
                ORDER BY u.id""").fetchall()
        stat["missing"] = len(rows)
        for r in rows:
            sym = (r["payload"] or {}).get("asset_symbol")
            if not sym:
                continue    # 组合腿（basket override）没有单一标的，"发布日参考价"无从谈起
            pub_close = _pub_close(ps, sym, r["published_at"].date())
            if pub_close is None:
                stat["no_bar"] += 1
                continue
            ov = OVERRIDES.get(str(r["id"]), {})
            if r["scored_ref"] and not ov.get("baseline_date") and ov.get("vs") != "condition_close":
                if abs(float(r["scored_ref"]) - float(pub_close)) > 0.01:
                    stat["drifted"].append(
                        {"unit_id": r["id"], "sym": sym,
                         "scored_with": float(r["scored_ref"]), "now": round(float(pub_close), 4)})
            if dry:
                stat["frozen"] += 1          # dry-run 也要报出"会钉死几条"，否则没法预检
            elif store.freeze_ref_price(r["id"], round(float(pub_close), 4)):
                stat["frozen"] += 1
    finally:
        pool.close()
    return stat


def main() -> None:
    if "--freeze-refs" in sys.argv:
        st = freeze_refs(dry="--dry-run" in sys.argv)
        verb = "预计钉死" if "--dry-run" in sys.argv else "已钉死"
        print(f"缺参考价的可定价 claim {st['missing']} 条：{verb} {st['frozen']}，"
              f"无行情跳过 {st['no_bar']}")
        if st["drifted"]:
            print(f"\n⚠ 行情已被改写、历史评分对着的参考价现在查不到了（{len(st['drifted'])} 条）：")
            for d in st["drifted"]:
                print(f"   #{d['unit_id']} {d['sym']}: 评分时 {d['scored_with']} → 现在 {d['now']}")
        else:
            print("对账：已评分单元的参考价与当前行情一致，没有发生漂移")
        return
    run(dry="--dry-run" in sys.argv)


if __name__ == "__main__":
    main()
