"""知识库体检：把「导入时只响一次、没人汇总」的问题一次报全。只读，不改任何数据。

用法：python -m fanisl.knowledge.audit        # 有需要处理的问题时退出码为 1

四项（生效版本的单元）：
1. 评分器解析不了的 A/B/C claim —— 到期那天会抛错（2026-08-29 至 09-23 的停评就是这一类）。
   v3 单元只看载荷，v1/v2 连同 scoring_overrides.json 一起看。
2. 到期该评却没有评分的时点 —— 行情已覆盖到阶梯日，但既没有评分也没有作废记录；
   说明每日评分没在跑，或跑到一半失败了。
3. 未登记的标的 —— claim 的 asset_symbol 不在 assets.py；标签既不是已登记标的、也不在
   extraction-guide §7 的受控词表里（多半是漏登记的标的，或同义分裂的主题词）。
4. 漏填 asset_symbol —— D 级 claim 的 asset_symbol 为空，而 asset_text 只点名了一个已登记标的
   （§6：标的可识别就要填，否则在标的页上不可见）。只是候选，需人工确认。
"""

from __future__ import annotations

import pathlib
import re
import sys
from collections import defaultdict

from .. import assets
from ..config import get_settings
from ..db import make_pool
from .scorers import _knobs, spec_problems
from .store import ACTIVE_RUN

GUIDE = pathlib.Path(__file__).with_name("extraction-guide.md")

# 人工核过、asset_symbol 就该留空的 D 级 claim（标的是行业指标、未登记的指数、比值或故事线，
# asset_text 里只是顺带点名了某个已登记标的）。2026-09-23/24 逐条核过。
REVIEWED_NULL_SYMBOL = {494, 1040, 1160, 1317, 1701, 1712, 1787}


def theme_vocabulary(guide_text: str) -> set[str]:
    """§7 的主题受控词表。

    §7 里「勿再用」的 semi、dram 说的是别拿它们当主题词；它们同时是已登记的 ETF（SEMI、DRAM），
    作资产标签是合法的，所以不单独报。
    """
    sec = guide_text.split("## 7.", 1)[1].split("\n## ", 1)[0]
    themes = sec.split("**主题标签**", 1)[1].split("- 新主题词", 1)[0]
    return set(re.findall(r"\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b", themes))


def _asset_names() -> dict[str, str]:
    names = {}
    for a in assets.all_assets():
        for k in [a.id, *a.aliases, *([a.display] if a.display else [])]:
            if k and len(k) >= 2:
                names[k] = a.id
    return names


def audit(conn) -> dict:
    units = conn.execute(
        f"SELECT u.id, u.content_id, u.kind, u.payload, u.tags FROM knowledge_units u "
        f"WHERE {ACTIVE_RUN} ORDER BY u.id").fetchall()
    last_bar = {r["symbol"]: r["last"] for r in conn.execute(
        "SELECT symbol, max(ts)::date AS last FROM daily_bars GROUP BY symbol")}
    done = {(r["unit_id"], r["horizon_label"]) for r in conn.execute(
        "SELECT unit_id, horizon_label FROM claim_scores "
        "UNION SELECT unit_id, horizon_label FROM claim_score_voids WHERE NOT rescore")}
    vocab = theme_vocabulary(GUIDE.read_text())
    names = _asset_names()

    unparsable, overdue = [], []
    bad_symbols: dict[str, list[int]] = defaultdict(list)
    bad_tags: dict[str, list[int]] = defaultdict(list)
    missing_symbol = []
    for u in units:
        p = u["payload"]
        for tag in u["tags"] or []:
            if assets.lookup(tag) is None and tag not in vocab:
                bad_tags[tag].append(u["id"])
        if u["kind"] != "claim":
            continue
        sym = p.get("asset_symbol")
        if sym and assets.lookup(sym) is None:
            bad_symbols[sym].append(u["id"])
        if p.get("verifiability") == "D":
            if not sym and u["id"] not in REVIEWED_NULL_SYMBOL:
                text = p.get("asset_text") or ""
                hit = {v for k, v in names.items()
                       if re.search(r"(?<![A-Za-z])" + re.escape(k) + r"(?![A-Za-z])", text)}
                if len(hit) == 1:
                    missing_symbol.append((u["id"], hit.pop(), text[:40]))
            continue
        problems = spec_problems(p, _knobs(u))
        if problems:
            unparsable.append((u["id"], problems))
            continue
        spec_sym = (_knobs(u).get("basket") or [sym])[0]
        covered = last_bar.get(spec_sym)
        for lad in p["scoring_spec"]["eval_ladder"]:
            if covered and lad <= str(covered) and (u["id"], lad) not in done:
                overdue.append((u["id"], lad))
    return {"unparsable": unparsable, "overdue": overdue, "bad_symbols": dict(bad_symbols),
            "bad_tags": dict(bad_tags), "missing_symbol": missing_symbol, "n_units": len(units)}


def _ids(ids: list[int], n: int = 8) -> str:
    head = " ".join(f"#{i}" for i in ids[:n])
    return head + (f" …共 {len(ids)} 条" if len(ids) > n else "")


def report(r: dict) -> int:
    print(f"体检：生效单元 {r['n_units']} 条\n")
    print(f"1. 评分器解析不了的 A/B/C：{len(r['unparsable'])}")
    for uid, probs in r["unparsable"]:
        print(f"   #{uid}：{'；'.join(probs)}")
    print(f"2. 到期未评的时点：{len(r['overdue'])}")
    for uid, lad in r["overdue"][:20]:
        print(f"   #{uid} @{lad}")
    print(f"3. 未登记的 asset_symbol：{len(r['bad_symbols'])} 个")
    for sym, ids in sorted(r["bad_symbols"].items(), key=lambda kv: -len(kv[1])):
        print(f"   {sym}：{_ids(ids)}")
    print(f"   未登记、也不在 §7 词表的标签：{len(r['bad_tags'])} 个")
    for tag, ids in sorted(r["bad_tags"].items(), key=lambda kv: -len(kv[1])):
        print(f"   {tag}：{_ids(ids)}")
    print(f"4. 疑似漏填 asset_symbol 的 D 级 claim：{len(r['missing_symbol'])}")
    for uid, aid, text in r["missing_symbol"]:
        print(f"   #{uid} → {aid}？「{text}」")
    return 1 if (r["unparsable"] or r["overdue"]) else 0


def main() -> None:
    pool = make_pool(get_settings().pg_knowledge_conninfo, min_size=1, max_size=1)
    try:
        with pool.connection() as conn:
            code = report(audit(conn))
    finally:
        pool.close()
    sys.exit(code)


if __name__ == "__main__":
    main()
