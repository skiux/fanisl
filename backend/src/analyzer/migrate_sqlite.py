"""一次性把旧 SQLite 数据迁进 PostgreSQL/TimescaleDB。

  python -m analyzer.migrate_sqlite [sqlite_path]

幂等：所有插入用 ON CONFLICT DO NOTHING；可重复跑。迁完会把自增序列对齐到 MAX(id)+1。
迁移源默认取 settings.db_path（旧 fanisl.db），目标取 settings.pg_conninfo。
"""

from __future__ import annotations

import sqlite3
import sys

from .config import get_settings
from .db import make_pool
from .marketstore import MarketStore
from .storage import Storage


def _rows(sq: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    try:
        return sq.execute(f"SELECT * FROM {table}").fetchall()
    except sqlite3.OperationalError:
        return []


def migrate(sqlite_path: str, conninfo: str) -> dict:
    sq = sqlite3.connect(sqlite_path)
    sq.row_factory = sqlite3.Row
    pool = make_pool(conninfo)
    # 建表 / hypertable / 策略
    Storage(pool)
    MarketStore(pool)

    counts: dict[str, int] = {}
    with pool.connection() as conn, conn.cursor() as cur:
        # 对话
        convs = _rows(sq, "conversations")
        cur.executemany(
            "INSERT INTO conversations(id, title, created_at, updated_at) "
            "VALUES (%s,%s,%s::timestamptz,%s::timestamptz) ON CONFLICT (id) DO NOTHING",
            [(r["id"], r["title"], r["created_at"], r["updated_at"]) for r in convs],
        )
        counts["conversations"] = len(convs)

        # 消息
        msgs = _rows(sq, "messages")
        cur.executemany(
            "INSERT INTO messages(id, conversation_id, role, content_json, created_at) "
            "VALUES (%s,%s,%s,%s,%s::timestamptz) ON CONFLICT (id) DO NOTHING",
            [
                (r["id"], r["conversation_id"], r["role"], r["content_json"], r["created_at"])
                for r in msgs
            ],
        )
        counts["messages"] = len(msgs)

        # 时间序列
        samples = _rows(sq, "metric_samples")
        cur.executemany(
            "INSERT INTO metric_samples(scope, symbol, metric, ts, value) "
            "VALUES (%s,%s,%s,%s::timestamptz,%s) "
            "ON CONFLICT (scope, symbol, metric, ts) DO NOTHING",
            [(r["scope"], r["symbol"], r["metric"], r["ts"], r["value"]) for r in samples],
        )
        counts["metric_samples"] = len(samples)

        # 催化剂（旧表无 id 列，让目标库自增）
        cats = _rows(sq, "catalyst_items")
        cur.executemany(
            "INSERT INTO catalyst_items(kind, symbol, event_date, title, payload_json, fetched_at) "
            "VALUES (%s,%s,%s,%s,%s,%s::timestamptz)",
            [
                (r["kind"], r["symbol"], r["event_date"], r["title"],
                 r["payload_json"], r["fetched_at"])
                for r in cats
            ],
        )
        counts["catalyst_items"] = len(cats)

        # 采集日志
        runs = _rows(sq, "collection_runs")
        cur.executemany(
            "INSERT INTO collection_runs(job, started_at, ok, note) "
            "VALUES (%s,%s::timestamptz,%s,%s)",
            [(r["job"], r["started_at"], r["ok"], r["note"]) for r in runs],
        )
        counts["collection_runs"] = len(runs)

        # 对齐自增序列到 MAX(id)+1
        for table in ("conversations", "messages"):
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}','id'), "
                f"GREATEST(COALESCE((SELECT MAX(id) FROM {table}), 1), 1))"
            )

    pool.close()
    sq.close()
    return counts


def main() -> None:
    settings = get_settings()
    src = sys.argv[1] if len(sys.argv) > 1 else settings.db_path
    counts = migrate(src, settings.pg_conninfo)
    print(f"迁移完成 {src} -> {settings.pg_conninfo}")
    for k, v in counts.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
