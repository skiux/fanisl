"""Knowledge-engine overview counts for the frontend entry page."""

from __future__ import annotations

from psycopg_pool import ConnectionPool


def overview_stats(pool: ConnectionPool) -> dict[str, int]:
    """Return current-library counts without loading capped list endpoints."""
    with pool.connection() as conn:
        row = conn.execute("""
            SELECT
              (SELECT count(*) FROM contents WHERE status <> 'superseded') AS contents,
              (SELECT count(*) FROM knowledge_units u
                JOIN contents c ON c.id=u.content_id
                WHERE c.status <> 'superseded') AS units,
              (SELECT count(*) FROM knowledge_units u
                JOIN contents c ON c.id=u.content_id
                WHERE c.status <> 'superseded' AND u.kind='claim') AS claims,
              (SELECT count(*) FROM knowledge_units u
                JOIN contents c ON c.id=u.content_id
                WHERE c.status <> 'superseded' AND u.kind='method') AS methods,
              (SELECT count(*) FROM knowledge_units u
                JOIN contents c ON c.id=u.content_id
                WHERE c.status <> 'superseded' AND u.kind='concept') AS concepts,
              (SELECT count(*) FROM knowledge_nodes) AS nodes,
              (SELECT count(*) FROM knowledge_nodes
                WHERE status='corroborated') AS corroborated,
              (SELECT count(*) FROM creators WHERE active) AS creators
        """).fetchone()
    return {key: int(value) for key, value in row.items()}
