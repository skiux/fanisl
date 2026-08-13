"""K6 抽查队列：提取忠实度的人工抽查（spot_checks 表，K0 建、此处启用）。

抽查对象是提取裁量（quote 忠实性 import 时已机械校验）：单元是否忠实反映原意、
有无断章取义、spec 判界是否合理。规范见 extraction-guide §10。

用法：
  python -m analyzer.knowledge.spotcheck sample [n]                  # 随机抽 n 条未查单元（默认 10）
  python -m analyzer.knowledge.spotcheck record <unit_id> <verdict> [note]   # faithful|unfaithful|unclear
  python -m analyzer.knowledge.spotcheck stats
"""

from __future__ import annotations

import sys

from ..config import get_settings
from ..db import make_pool
from .store import ACTIVE_RUN

_VERDICTS = {"faithful", "unfaithful", "unclear"}


def sample(pool, n: int = 10) -> list[dict]:
    with pool.connection() as conn:
        return conn.execute(f"""
            SELECT u.id, u.kind, u.locator, u.quote, cr.name AS creator,
              c.id AS content_id, c.title AS content_title
            FROM knowledge_units u
            JOIN creators cr ON cr.id=u.creator_id
            JOIN contents c ON c.id=u.content_id
            WHERE NOT EXISTS (SELECT 1 FROM spot_checks s WHERE s.unit_id=u.id)
              AND {ACTIVE_RUN}
            ORDER BY random() LIMIT %s""", (n,)).fetchall()


def record(pool, unit_id: int, verdict: str, note: str | None) -> None:
    if verdict not in _VERDICTS:
        raise SystemExit(f"verdict 须为 {_VERDICTS}")
    with pool.connection() as conn:
        conn.execute("INSERT INTO spot_checks(unit_id, verdict, note) VALUES (%s,%s,%s)",
                     (unit_id, verdict, note))


def stats(pool) -> dict:
    with pool.connection() as conn:
        r = conn.execute(f"""
            SELECT (SELECT count(*) FROM knowledge_units u WHERE {ACTIVE_RUN}) AS total,
              count(DISTINCT unit_id) AS checked,
              count(*) FILTER (WHERE verdict='faithful') AS faithful,
              count(*) FILTER (WHERE verdict='unfaithful') AS unfaithful,
              count(*) FILTER (WHERE verdict='unclear') AS unclear
            FROM spot_checks""").fetchone()
        r["recent"] = conn.execute("""
            SELECT s.unit_id, s.verdict, s.note, s.created_at, u.kind, left(u.quote, 40) AS quote
            FROM spot_checks s JOIN knowledge_units u ON u.id=s.unit_id
            ORDER BY s.created_at DESC LIMIT 20""").fetchall()
    return r


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "sample"
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        if cmd == "sample":
            n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
            for r in sample(pool, n):
                print(f"#{r['id']:<4} {r['kind']:<8} {r['creator'][:6]} c{r['content_id']} "
                      f"[{r['locator'] or '—'}]\n      「{r['quote'][:70]}…」")
        elif cmd == "record":
            record(pool, int(sys.argv[2]), sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
            print("已记录")
        elif cmd == "stats":
            s = stats(pool)
            print(f"覆盖 {s['checked']}/{s['total']}  faithful {s['faithful']} "
                  f"unfaithful {s['unfaithful']} unclear {s['unclear']}")
        else:
            raise SystemExit(f"未知命令：{cmd}")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
