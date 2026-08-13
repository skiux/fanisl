"""Paginated read models for knowledge-library browsing."""

from __future__ import annotations

from typing import Any

from psycopg_pool import ConnectionPool


_SCORES_AGG = (
    "COALESCE((SELECT json_agg(json_build_object("
    "'horizon_label', s.horizon_label, 'outcome', s.outcome, 'realized', s.realized) "
    "ORDER BY s.horizon_label) FROM claim_scores s WHERE s.unit_id=u.id), '[]') AS scores"
)


def browse_units_page(
    pool: ConnectionPool,
    *,
    kind: str | None = None,
    creator_id: int | None = None,
    tag: str | None = None,
    symbol: str | None = None,
    q: str | None = None,
    scored: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Return a stable page plus full-result counts for the current filters."""
    conditions = ["c.status <> 'superseded'"]
    params: list[object] = []
    if kind:
        conditions.append("u.kind=%s")
        params.append(kind)
    if creator_id:
        conditions.append("u.creator_id=%s")
        params.append(creator_id)
    if tag:
        conditions.append("%s = ANY(u.tags)")
        params.append(tag)
    if symbol:
        conditions.append("u.payload->>'asset_symbol'=%s")
        params.append(symbol)
    if q:
        conditions.append("(u.quote ILIKE %s OR u.payload::text ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])
    if scored:
        conditions.append("EXISTS (SELECT 1 FROM claim_scores sx WHERE sx.unit_id=u.id)")
    where = "WHERE " + " AND ".join(conditions)

    with pool.connection() as conn:
        counts = conn.execute(
            f"SELECT count(*) AS total, "
            f"count(*) FILTER (WHERE u.kind='claim') AS claims, "
            f"count(*) FILTER (WHERE u.kind='method') AS methods, "
            f"count(*) FILTER (WHERE u.kind='concept') AS concepts "
            f"FROM knowledge_units u JOIN contents c ON c.id=u.content_id {where}",
            tuple(params),
        ).fetchone()
        rows = conn.execute(
            f"SELECT u.*, cr.name AS creator, c.title AS content_title, {_SCORES_AGG} "
            f"FROM knowledge_units u JOIN creators cr ON cr.id=u.creator_id "
            f"JOIN contents c ON c.id=u.content_id {where} "
            f"ORDER BY u.published_at DESC NULLS LAST, u.id DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        ).fetchall()
        creator_counts = conn.execute(
            f"SELECT u.creator_id, count(*) AS n FROM knowledge_units u "
            f"JOIN contents c ON c.id=u.content_id {where} "
            f"GROUP BY u.creator_id ORDER BY u.creator_id",
            tuple(params),
        ).fetchall()

    total = int(counts["total"])
    return {
        "items": rows,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(rows) < total,
        "counts": {
            "claim": int(counts["claims"]),
            "method": int(counts["methods"]),
            "concept": int(counts["concepts"]),
        },
        "creator_counts": {str(row["creator_id"]): int(row["n"]) for row in creator_counts},
    }


def browse_nodes_page(
    pool: ConnectionPool,
    *,
    kind: str | None = None,
    status: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    """Return all long-term nodes through a stable, searchable page contract."""
    conditions: list[str] = []
    params: list[object] = []
    if kind:
        conditions.append("n.kind=%s")
        params.append(kind)
    if status:
        conditions.append("n.status=%s")
        params.append(status)
    if tag:
        conditions.append("%s = ANY(n.tags)")
        params.append(tag)
    if q:
        conditions.append("(n.title ILIKE %s OR n.canonical ILIKE %s OR array_to_string(n.tags, ' ') ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    aggregate = f"""
        FROM knowledge_nodes n
        JOIN node_attestations a ON a.node_id=n.id
        JOIN knowledge_units u ON u.id=a.unit_id
        LEFT JOIN claim_scores s ON s.unit_id=u.id
        {where}
        GROUP BY n.id
    """
    with pool.connection() as conn:
        total = conn.execute(
            f"SELECT count(*) AS n FROM (SELECT n.id {aggregate}) rows",
            tuple(params),
        ).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT n.*, count(DISTINCT a.id) AS n_attest,
              count(DISTINCT u.creator_id) AS n_creators,
              count(DISTINCT u.content_id) AS n_contents,
              min(u.published_at) AS first_seen, max(u.published_at) AS last_seen,
              count(*) FILTER (WHERE s.outcome='hit') AS hit,
              count(*) FILTER (WHERE s.outcome='partial') AS partial,
              count(*) FILTER (WHERE s.outcome='miss') AS miss
              {aggregate}
              ORDER BY n_attest DESC, n.updated_at DESC, n.id DESC LIMIT %s OFFSET %s""",
            (*params, limit, offset),
        ).fetchall()
    total_int = int(total)
    return {
        "items": rows,
        "total": total_int,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(rows) < total_int,
    }


_VERIFICATION_BUCKETS = {
    "recent": ("hit", "partial", "miss"),
    "unavailable": ("unpriceable", "condition_unverifiable"),
    "review": ("condition_not_met", "pending"),
}


def verification_summary(pool: ConnectionPool, *, days: int) -> dict[str, Any]:
    """Return uncapped queue counts plus the nearest due records."""
    with pool.connection() as conn:
        counts = conn.execute("""
            SELECT
              count(*) FILTER (WHERE outcome IN ('hit','partial','miss')) AS completed,
              count(*) FILTER (WHERE outcome IN ('unpriceable','condition_unverifiable')) AS unavailable,
              count(*) FILTER (WHERE outcome IN ('condition_not_met','pending')) AS review
            FROM claim_scores
        """).fetchone()
        due = conn.execute("""
            SELECT u.id AS unit_id, u.quote, u.payload, u.published_at,
              u.ref_price_at_publish, cr.name AS creator, c.title AS content_title,
              ladder.label AS horizon_label
            FROM knowledge_units u
            JOIN creators cr ON cr.id=u.creator_id
            JOIN contents c ON c.id=u.content_id
            CROSS JOIN LATERAL jsonb_array_elements_text(
              COALESCE(u.payload->'scoring_spec'->'eval_ladder', '[]'::jsonb)
            ) AS ladder(label)
            WHERE u.kind='claim' AND c.status <> 'superseded'
              AND ladder.label ~ '^\d{4}-\d{2}-\d{2}$'
              AND ladder.label::date BETWEEN current_date AND current_date + %s
              AND NOT EXISTS (
                SELECT 1 FROM claim_scores s
                WHERE s.unit_id=u.id AND s.horizon_label=ladder.label
              )
            ORDER BY ladder.label, u.published_at DESC NULLS LAST, u.id DESC
            LIMIT 4
        """, (days,)).fetchall()
        due_count = conn.execute("""
            SELECT count(*) AS n FROM knowledge_units u
            JOIN contents c ON c.id=u.content_id
            CROSS JOIN LATERAL jsonb_array_elements_text(
              COALESCE(u.payload->'scoring_spec'->'eval_ladder', '[]'::jsonb)
            ) AS ladder(label)
            WHERE u.kind='claim' AND c.status <> 'superseded'
              AND ladder.label ~ '^\d{4}-\d{2}-\d{2}$'
              AND ladder.label::date BETWEEN current_date AND current_date + %s
              AND NOT EXISTS (
                SELECT 1 FROM claim_scores s
                WHERE s.unit_id=u.id AND s.horizon_label=ladder.label
              )
        """, (days,)).fetchone()
    return {
        "overview": {
            "due": int(due_count["n"]),
            "completed": int(counts["completed"]),
            "unavailable": int(counts["unavailable"]),
            "review": int(counts["review"]),
        },
        "nearest_due": due,
    }


def verification_page(
    pool: ConnectionPool,
    *,
    bucket: str,
    days: int,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    """Return one verification bucket with stable paging and a full count."""
    with pool.connection() as conn:
        if bucket == "due":
            common = """
                FROM knowledge_units u
                JOIN creators cr ON cr.id=u.creator_id
                JOIN contents c ON c.id=u.content_id
                CROSS JOIN LATERAL jsonb_array_elements_text(
                  COALESCE(u.payload->'scoring_spec'->'eval_ladder', '[]'::jsonb)
                ) AS ladder(label)
                WHERE u.kind='claim' AND c.status <> 'superseded'
                  AND ladder.label ~ '^\d{4}-\d{2}-\d{2}$'
                  AND ladder.label::date BETWEEN current_date AND current_date + %s
                  AND NOT EXISTS (
                    SELECT 1 FROM claim_scores s
                    WHERE s.unit_id=u.id AND s.horizon_label=ladder.label
                  )
            """
            total = conn.execute(f"SELECT count(*) AS n {common}", (days,)).fetchone()["n"]
            rows = conn.execute(
                f"SELECT u.id AS unit_id, u.quote, u.payload, u.published_at, "
                f"u.ref_price_at_publish, cr.name AS creator, c.title AS content_title, "
                f"ladder.label AS horizon_label {common} "
                f"ORDER BY ladder.label, u.published_at DESC NULLS LAST, u.id DESC "
                f"LIMIT %s OFFSET %s",
                (days, limit, offset),
            ).fetchall()
        else:
            outcomes = _VERIFICATION_BUCKETS[bucket]
            common = """
                FROM claim_scores s
                JOIN knowledge_units u ON u.id=s.unit_id
                JOIN creators cr ON cr.id=u.creator_id
                JOIN contents c ON c.id=u.content_id
                WHERE s.outcome = ANY(%s) AND c.status <> 'superseded'
            """
            total = conn.execute(f"SELECT count(*) AS n {common}", (list(outcomes),)).fetchone()["n"]
            rows = conn.execute(
                f"SELECT s.id AS score_id, s.unit_id, s.horizon_label, s.outcome, s.realized, "
                f"s.eval_ts, s.created_at AS scored_at, u.quote, u.payload, u.published_at, "
                f"u.ref_price_at_publish, cr.name AS creator, c.title AS content_title {common} "
                f"ORDER BY s.created_at DESC, s.id DESC LIMIT %s OFFSET %s",
                (list(outcomes), limit, offset),
            ).fetchall()
    total_int = int(total)
    return {
        "items": rows,
        "total": total_int,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(rows) < total_int,
    }
