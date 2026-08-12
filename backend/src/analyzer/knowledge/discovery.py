"""K6 发现层：Method→研究 harness 候选清单 + 周报（知识增量与状态变更）。

- harness 候选：testability=A 的 method 节点（现有数据可回测），流向研究管线前的
  人工 prereg 纪律不变——这里只产候选清单，不自动立 H。
- 周报：过去 N 天的知识增量/新评分/关系边/即将到期时点，markdown 落
  data_export/reports/，API 与 collector 复用同一生成函数。
  （状态变更为 v0 近似口径：报告当前非 active 节点全量，无逐日历史表。）

用法：python -m analyzer.knowledge.discovery harness | weekly [--days 7]
"""

from __future__ import annotations

import datetime as dt
import pathlib
import sys

from ..config import get_settings
from ..db import make_pool

REPORT_DIR = pathlib.Path(__file__).resolve().parents[4] / "data_export" / "reports"


def harness_candidates(pool) -> list[dict]:
    """可回测 method 节点：testability=A，附与已杀 H 的重叠标记（防重杀尸体）。"""
    with pool.connection() as conn:
        return conn.execute("""
            SELECT n.id AS node_id, n.title, n.canonical, n.status,
              count(a.id) AS n_attest, count(DISTINCT u.creator_id) AS n_creators,
              (array_agg(u.payload ORDER BY u.id))[1] AS payload
            FROM knowledge_nodes n
            JOIN node_attestations a ON a.node_id=n.id
            JOIN knowledge_units u ON u.id=a.unit_id
            WHERE n.kind='method' AND u.payload->>'testability'='A' AND n.status != 'retired'
            GROUP BY n.id ORDER BY n_attest DESC, n.id""").fetchall()


def _fmt_outcome(o: str) -> str:
    return {"hit": "✓", "partial": "½", "miss": "✗"}.get(o, o)


def weekly_report(pool, *, days: int = 7) -> dict:
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    today = dt.date.today()
    with pool.connection() as conn:
        new_contents = conn.execute(
            "SELECT cr.name, count(*) AS n, COALESCE(sum(length(c.raw)),0) AS chars "
            "FROM contents c JOIN creators cr ON cr.id=c.creator_id "
            "WHERE c.fetched_at >= %s GROUP BY cr.name", (since,)).fetchall()
        new_units = conn.execute(
            "SELECT u.kind, count(*) AS n FROM knowledge_units u "
            "WHERE u.created_at >= %s GROUP BY u.kind", (since,)).fetchall()
        new_scores = conn.execute("""
            SELECT s.unit_id, s.outcome, s.horizon_label, s.created_at, cr.name AS creator,
              u.payload->>'asset_symbol' AS sym, u.payload->>'direction' AS dir,
              u.payload->>'verifiability' AS grade
            FROM claim_scores s JOIN knowledge_units u ON u.id=s.unit_id
            JOIN creators cr ON cr.id=u.creator_id
            WHERE s.created_at >= %s ORDER BY s.created_at""", (since,)).fetchall()
        new_edges = conn.execute("""
            SELECT r.relation, r.note, a.id AS a_id, a.title AS a_title, b.id AS b_id, b.title AS b_title
            FROM node_relations r JOIN knowledge_nodes a ON a.id=r.a_node
            JOIN knowledge_nodes b ON b.id=r.b_node
            WHERE r.created_at >= %s""", (since,)).fetchall()
        node_status = conn.execute(
            "SELECT status, count(*) AS n FROM knowledge_nodes GROUP BY status").fetchall()
        notable_nodes = conn.execute(
            "SELECT title, status FROM knowledge_nodes "
            "WHERE status NOT IN ('active') ORDER BY status, updated_at DESC").fetchall()
        due_next = conn.execute("""
            SELECT u.id AS unit_id, cr.name AS creator, u.payload->>'asset_symbol' AS sym,
              u.payload->>'direction' AS dir, d AS horizon_label
            FROM knowledge_units u
            JOIN creators cr ON cr.id=u.creator_id,
              jsonb_array_elements_text(u.payload->'scoring_spec'->'eval_ladder') AS d
            WHERE u.kind='claim' AND u.payload->'scoring_spec' IS NOT NULL
              AND d::date > %s AND d::date <= %s
              AND NOT EXISTS (SELECT 1 FROM claim_scores s
              WHERE s.unit_id=u.id AND s.horizon_label=d)
            ORDER BY d::date, u.id""",
            (today, today + dt.timedelta(days=7))).fetchall()
        spot = conn.execute(
            "SELECT count(DISTINCT unit_id) AS checked, "
            "(SELECT count(*) FROM knowledge_units) AS total FROM spot_checks").fetchone()

    lines = [f"# 知识引擎周报 · {today}", "",
             f"窗口：过去 {days} 天", ""]
    lines.append("## 知识增量")
    if new_contents:
        for r in new_contents:
            lines.append(f"- 新内容：{r['name']} {r['n']} 篇（{r['chars'] / 1000:.1f}k 字）")
    else:
        lines.append("- 无新内容入库（提醒：backfill_transcripts 抓新视频）")
    if new_units:
        lines.append("- 新单元：" + "，".join(f"{r['kind']} {r['n']}" for r in new_units))
    lines.append("")
    lines.append(f"## 新到期评分（{len(new_scores)} 个时点）")
    for r in new_scores:
        lines.append(f"- {_fmt_outcome(r['outcome'])} {r['creator']} · {r['sym'] or '—'} "
                     f"{r['dir'] or ''} {r['grade']} @{r['horizon_label']}")
    if not new_scores:
        lines.append("- 本期无新到期")
    lines.append("")
    if new_edges:
        lines.append("## 新关系边")
        for r in new_edges:
            lines.append(f"- [{r['relation']}] {r['a_title']} ↔ {r['b_title']}")
        lines.append("")
    lines.append("## 节点状态")
    lines.append("- 分布：" + "，".join(f"{r['status']} {r['n']}" for r in node_status))
    for r in notable_nodes[:20]:
        lines.append(f"- [{r['status']}] {r['title']}")
    lines.append("")
    lines.append("## 运营")
    lines.append(f"- 未来 7 天将到期评分时点：{len(due_next)}")
    lines.append(f"- 抽查覆盖：{spot['checked']}/{spot['total']} 单元")
    md = "\n".join(lines) + "\n"

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = REPORT_DIR / f"weekly-{today}.md"
    out.write_text(md)
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "path": str(out), "markdown": md,
        "summary": {
            "new_contents": list(new_contents),
            "new_units": list(new_units),
            "new_scores": list(new_scores),
            "new_edges": list(new_edges),
            "node_status": list(node_status),
            "notable_nodes": list(notable_nodes),
            "due_next": list(due_next),
            "spot_check": dict(spot),
        },
    }


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "weekly"
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 7
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        if cmd == "harness":
            for r in harness_candidates(pool):
                p = r["payload"]
                overlap = p.get("overlap_with_killed") or []
                print(f"[node {r['node_id']}] {r['title']}  提及×{r['n_attest']} 信源×{r['n_creators']}")
                print(f"    数据需求: {', '.join(p.get('data_requirements') or []) or '—'}"
                      f"   已杀重叠: {', '.join(overlap) or '无'}")
        elif cmd == "weekly":
            print(weekly_report(pool, days=days)["markdown"])
        else:
            raise SystemExit(f"未知命令：{cmd}")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
