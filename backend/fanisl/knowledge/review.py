"""单元核查的知识席位端：处理站上提交的核查意见——答复、修改单元、复盘。

站上用户在单元详情里提交核查（HTTP 接口归 base 席位）；知识席位用本 CLI 处理队列。
**答复只走这里，网站写不了**，站上无法冒充知识席位发言。处理纪律见 knowledge/AGENTS.md。

用法：
  python -m fanisl.knowledge.review list [--status open|answered|closed|all]
  python -m fanisl.knowledge.review show <review_id>
  python -m fanisl.knowledge.review amend <unit_id> --review <review_id> --reason "…" \\
      [--payload-file new_payload.json] [--quote "…"] [--tags a,b,c]
  python -m fanisl.knowledge.review answer <review_id> --outcome fixed|no_change|needs_info \\
      --body "…" [--root-cause "…"] [--sweep "…"] [--followup "…"]
  python -m fanisl.knowledge.review void <unit_id> <horizon_label> --reason "…" [--rescore]
      # 作废本不该存在的评分时点（原样留在 claim_score_voids，统计不再计）；
      # --rescore：评分器没按冻结的判据执行，配置修好后重评
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..config import get_settings
from ..db import make_pool
from .store import KnowledgeStore, ReviewConflict

AUTHOR = "claude-session"


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _cmd_list(store: KnowledgeStore, status: str) -> None:
    rows = store.list_reviews(status=None if status == "all" else status)
    if not rows:
        print(f"没有 {status} 的核查")
        return
    for r in rows:
        print(f"#{r['id']:<4} {r['status']:<9} {r['category']:<9} unit {r['unit_id']} "
              f"({r['kind']}{'/' + r['verifiability'] if r['verifiability'] else ''}) "
              f"c{r['content_id']} {r['creator']}  消息 {r['n_messages']}  {str(r['updated_at'])[:16]}")
        print(f"      「{r['quote']}…」")
        print(f"      最新：{r['last_message']}")


def _cmd_show(store: KnowledgeStore, review_id: int) -> None:
    r = store.review_detail(review_id)
    if r is None:
        raise SystemExit(f"核查 {review_id} 不存在")
    u = store.unit_detail(r["unit_id"])
    print(f"核查 #{r['id']}  {r['status']}  {r['category']}  提出人 {r['created_by']}  {str(r['created_at'])[:16]}")
    print(f"\n单元 #{u['id']} {u['kind']}  c{u['content_id']} {u['content_title']}  定位 {u['locator']}")
    print(f"quote：{u['quote']}")
    print(f"tags：{u['tags']}")
    print(f"payload：\n{_dump(u['payload'])}")
    if u.get("scores"):
        print(f"评分记录：{_dump(u['scores'])}")
    for v in store.score_voids(u["id"]):
        tag = "待重评" if v["rescore"] else "作废"
        print(f"{tag}的评分 {v['horizon_label']}（{v['score'].get('outcome')}）：{v['reason']}")
    print("\n对话：")
    for m in r["messages"]:
        print(f"  [{m['role']}] {m['author']}  {str(m['created_at'])[:16]}")
        print("    " + m["body"].replace("\n", "\n    "))
        if m["resolution"]:
            print(f"    结论：{_dump(m['resolution'])}")
    for a in r["amendments"]:
        print(f"\n修改 #{a['id']}  {a['author']}  {str(a['created_at'])[:16]}  改动 {a['changed']}")
        print(f"  原因：{a['reason']}")
        for field in a["changed"]:
            key = field.split(".", 1)
            pick = (lambda d: d["payload"].get(key[1])) if key[0] == "payload" else (lambda d: d[key[0]])
            print(f"  {field}：{_dump(pick(a['before']))}  →  {_dump(pick(a['after']))}")


def _cmd_amend(store: KnowledgeStore, args: argparse.Namespace) -> None:
    payload = json.loads(Path(args.payload_file).read_text()) if args.payload_file else None
    tags = [t.strip() for t in args.tags.split(",") if t.strip()] if args.tags is not None else None
    a = store.amend_unit(args.unit_id, reason=args.reason, author=args.author, quote=args.quote,
                         payload=payload, tags=tags, review_id=args.review)
    print(f"已修改单元 #{args.unit_id}，修改记录 #{a['id']}，改动 {a['changed']}")


def _cmd_answer(store: KnowledgeStore, args: argparse.Namespace) -> None:
    r = store.answer_review(args.review_id, body=args.body, outcome=args.outcome, author=args.author,
                            root_cause=args.root_cause, sweep=args.sweep, followup=args.followup)
    print(f"已答复核查 #{r['id']}，状态 → {r['status']}")


def _cmd_void(store: KnowledgeStore, args: argparse.Namespace) -> None:
    v = store.void_score(args.unit_id, args.horizon_label, reason=args.reason, author=args.author,
                         rescore=args.rescore)
    print(f"已作废单元 #{args.unit_id} 在 {args.horizon_label} 的评分（原为 {v['score'].get('outcome')}），"
          f"作废记录 #{v['id']}{'，待重评' if args.rescore else ''}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m fanisl.knowledge.review")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list")
    p.add_argument("--status", default="open", choices=("open", "answered", "closed", "all"))
    p = sub.add_parser("show")
    p.add_argument("review_id", type=int)
    p = sub.add_parser("amend")
    p.add_argument("unit_id", type=int)
    p.add_argument("--review", type=int, help="挂到哪条核查下（outcome=fixed 要求必须挂）")
    p.add_argument("--reason", required=True)
    p.add_argument("--payload-file", help="完整的新 payload（JSON 文件），整体替换并重验")
    p.add_argument("--quote")
    p.add_argument("--tags", help="逗号分隔，整体替换")
    p.add_argument("--author", default=AUTHOR)
    p = sub.add_parser("answer")
    p.add_argument("review_id", type=int)
    p.add_argument("--outcome", required=True, choices=KnowledgeStore.REVIEW_OUTCOMES)
    p.add_argument("--body", required=True, help="给用户看的答复")
    p.add_argument("--root-cause", help="为什么会错（outcome=fixed 必填）")
    p.add_argument("--sweep", help="同类单元查了哪些、结果如何（outcome=fixed 必填）")
    p.add_argument("--followup", help="系统性的后续：规范条款 / 机械检查 / 计划条目")
    p.add_argument("--author", default=AUTHOR)
    p = sub.add_parser("void")
    p.add_argument("unit_id", type=int)
    p.add_argument("horizon_label")
    p.add_argument("--reason", required=True)
    p.add_argument("--rescore", action="store_true", help="评分器没按冻结的判据执行，配置修好后重评")
    p.add_argument("--author", default=AUTHOR)
    args = ap.parse_args()

    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        if args.cmd == "list":
            _cmd_list(store, args.status)
        elif args.cmd == "show":
            _cmd_show(store, args.review_id)
        elif args.cmd == "amend":
            _cmd_amend(store, args)
        elif args.cmd == "void":
            _cmd_void(store, args)
        else:
            _cmd_answer(store, args)
    except (ValueError, LookupError, ReviewConflict) as e:
        raise SystemExit(f"拒绝：{e}")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
