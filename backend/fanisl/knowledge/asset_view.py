"""按**标的**聚合的读模型——标的工作台的数据脊柱。

为什么单独一个模块：知识库里"某个标的"的证据分散在两处——claim 把标的写在
`payload.asset_symbol`，method/concept 只有小写资产标签。任何"这个标的我们沉淀了什么"
的问题都得两路合查，而 browser.py 的分页读模型是按 kind/信源/标签组织的，塞不进去。

口径（与 domain-model.md §5 一致，前端不得另起）：
- 命中率 = (hit + 0.5×partial) / (hit + partial + miss)；`condition_*` 与 `unpriceable`
  **不进分母**。样本量随命中率一起返回，前端必须带 n 展示。
- **未到期判断**从冻结的 `eval_ladder` 反查（同 store.verification_queue 的做法）：
  评分行只代表已发生的判定，没有评分行不等于没有工作。
- 一条单元可以同时属于多个标的（tags 有多个资产标签），这是对的，不去重成"主标的"。
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from psycopg_pool import ConnectionPool

from .. import assets
from .store import ACTIVE_RUN

# 单元 → 标的的展开：claim 用 payload.asset_symbol（**不限于登记表**，未登记的也要露出来，
# 否则登记漏了就永远发现不了；别名拼法先经 amap 归一，"XAU/USD" 与 "XAUUSD" 算同一个）；
# method/concept 用资产标签（**必须限定在登记表内**，否则 ai-capex 这类主题标签会被当成标的）。
# UNION 去重：两路都命中的算一条。
def keys_cte(*, scoped: bool) -> str:
    """单元 → 标的的展开。

    `scoped=True` 时把标的谓词**推进 CTE 里**，只展开这个标的的单元。
    单标的档案要跑 5 个这样的查询，不推进去就是 5 次全表展开（1147 条单元 × unnest 标签），
    经隧道实测 `/asset/{id}` 因此要 5.8 秒。推进去之后只碰几十行。
    """
    scope = ("""
      AND (u.payload->>'asset_symbol' = ANY(%(syms)s) OR u.tags && %(scope_tags)s::text[])
    """ if scoped else "")
    return f"""
WITH amap AS (
    SELECT * FROM unnest(%(alias_raw)s::text[], %(alias_canon)s::text[]) AS t(raw, canon)
), live AS (
    SELECT u.id, u.kind, u.creator_id, u.published_at, u.payload, u.tags
    FROM knowledge_units u
    WHERE {ACTIVE_RUN}{scope}
), keys AS (
    SELECT l.id, l.kind, l.creator_id, l.published_at,
           COALESCE((SELECT canon FROM amap WHERE amap.raw = upper(l.payload->>'asset_symbol')),
                    upper(l.payload->>'asset_symbol')) AS asset
    FROM live l WHERE l.payload->>'asset_symbol' IS NOT NULL
    UNION
    SELECT l.id, l.kind, l.creator_id, l.published_at, upper(t) AS asset
    FROM live l, unnest(l.tags) AS t WHERE upper(t) = ANY(%(asset_keys)s)
)
"""


_KEYS_CTE = keys_cte(scoped=False)
_KEYS_SCOPED = keys_cte(scoped=True)


def _base_params() -> dict:
    """keys CTE 的公共参数：别名归一映射 + 允许当作标的的标签白名单。"""
    raw: list[str] = []
    canon: list[str] = []
    for a in assets.all_assets():
        for alias in a.aliases:
            raw.append(alias.strip().upper())
            canon.append(a.id)
    return {"alias_raw": raw, "alias_canon": canon,
            "asset_keys": [a.id for a in assets.all_assets()]}


def hit_rate(hits: int, partials: int, misses: int) -> float | None:
    """命中率；分母为 0 时返回 None（不返回 0——"没样本"不是"全错"）。"""
    scored = hits + partials + misses
    return round((hits + 0.5 * partials) / scored, 3) if scored else None


def _decorate(row: dict) -> dict:
    row["hit_rate"] = hit_rate(row.get("hits") or 0, row.get("partials") or 0,
                               row.get("misses") or 0)
    a = assets.lookup(row["asset"])
    row["display"] = a.display if a else None
    row["asset_class"] = a.asset_class if a else None
    row["class_label"] = assets.CLASS_LABELS.get(a.asset_class) if a else None
    row["registered"] = a is not None
    row["has_bars"] = bool(a and (a.yf or a.fred))
    row["has_metrics"] = bool(a and a.metric_symbol)
    return row


_COUNTS = """
    count(*) AS units,
    count(*) FILTER (WHERE k.kind='claim')   AS claims,
    count(*) FILTER (WHERE k.kind='method')  AS methods,
    count(*) FILTER (WHERE k.kind='concept') AS concepts,
    count(DISTINCT k.creator_id) AS creators,
    min(k.published_at) AS first_seen,
    max(k.published_at) AS last_seen
"""

_SCORE_COUNTS = """
    COALESCE(s.scored, 0)      AS scored,
    COALESCE(s.hits, 0)        AS hits,
    COALESCE(s.partials, 0)    AS partials,
    COALESCE(s.misses, 0)      AS misses,
    COALESCE(s.unresolved, 0)  AS unresolved,
    COALESCE(o.open_claims, 0) AS open_claims
"""

# 评分行按标的汇总。scored 只数进分母的三种；unresolved 是条件未触发/不可验/无价格。
_SCORES_CTE = """
, sc AS (
    SELECT k.asset,
      count(*) FILTER (WHERE sr.outcome IN ('hit','partial','miss')) AS scored,
      count(*) FILTER (WHERE sr.outcome='hit')     AS hits,
      count(*) FILTER (WHERE sr.outcome='partial') AS partials,
      count(*) FILTER (WHERE sr.outcome='miss')    AS misses,
      count(*) FILTER (WHERE sr.outcome NOT IN ('hit','partial','miss')) AS unresolved
    FROM keys k JOIN claim_scores sr ON sr.unit_id = k.id
    GROUP BY k.asset
)
"""

# 未到期判断：冻结阶梯里还没写评分行、且日期在今天或以后的时点。
# **这里按 claim 去重数"条数"，open_claims() 返回的是"时点"**——一条判断可以有多个阶梯日，
# 两个数不一样是对的（XAUUSD 实测 23 条 / 32 个时点）。
_OPEN_CTE = """
, op AS (
    SELECT k.asset, count(DISTINCT k.id) AS open_claims
    FROM keys k
    JOIN knowledge_units u ON u.id = k.id
    CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(u.payload->'scoring_spec'->'eval_ladder', '[]'::jsonb)) AS ladder(label)
    WHERE k.kind='claim'
      AND ladder.label ~ '^\\d{4}-\\d{2}-\\d{2}$'
      AND ladder.label::date >= current_date
      AND NOT EXISTS (SELECT 1 FROM claim_scores s
                      WHERE s.unit_id = k.id AND s.horizon_label = ladder.label)
    GROUP BY k.asset
)
"""


def asset_universe(pool: ConnectionPool) -> list[dict[str, Any]]:
    """全部有知识沉淀的标的 + 计数 + 战绩 + 未到期数。一条 SQL，不许 N+1。

    只返回"库里真有东西"的标的；登记了但一条单元都没有的（QQQ/SPY/MSTR 等）不在这里，
    由调用方决定要不要把登记表的其余部分并进来。
    """
    sql = f"""
    {_KEYS_CTE}{_SCORES_CTE}{_OPEN_CTE}
    SELECT k.asset, {_COUNTS}, {_SCORE_COUNTS}
    FROM keys k
    LEFT JOIN sc s ON s.asset = k.asset
    LEFT JOIN op o ON o.asset = k.asset
    GROUP BY k.asset, s.scored, s.hits, s.partials, s.misses, s.unresolved, o.open_claims
    ORDER BY units DESC, k.asset
    """
    with pool.connection() as conn:
        rows = conn.execute(sql, _base_params()).fetchall()
    return [_decorate(r) for r in rows]


def _one_asset_params(asset_id: str) -> dict:
    """单标的查询的参数：归一后的 id（keys CTE 已把别名折叠到它上面）。"""
    canonical = assets.resolve_id(asset_id) or (asset_id or "").strip().upper()
    syms, tags = assets.symbol_variants(canonical)
    return {**_base_params(), "asset": canonical, "tags": [canonical],
            "syms": syms, "scope_tags": tags}


def asset_summary(pool: ConnectionPool, asset_id: str) -> dict[str, Any] | None:
    """单个标的的计数与战绩（口径与 asset_universe 完全一致）。无任何单元返回 None。"""
    sql = f"""
    {_KEYS_SCOPED}{_SCORES_CTE}{_OPEN_CTE}
    SELECT k.asset, {_COUNTS}, {_SCORE_COUNTS}
    FROM keys k
    LEFT JOIN sc s ON s.asset = k.asset
    LEFT JOIN op o ON o.asset = k.asset
    WHERE k.asset = %(asset)s
    GROUP BY k.asset, s.scored, s.hits, s.partials, s.misses, s.unresolved, o.open_claims
    """
    with pool.connection() as conn:
        row = conn.execute(sql, _one_asset_params(asset_id)).fetchone()
    return _decorate(row) if row else None


def by_creator(pool: ConnectionPool, asset_id: str) -> list[dict[str, Any]]:
    """"谁在这个标的上说得准"——按信源拆开的计数与战绩。"""
    sql = f"""
    {_KEYS_SCOPED}
    , sc AS (
        SELECT k.creator_id,
          count(*) FILTER (WHERE sr.outcome IN ('hit','partial','miss')) AS scored,
          count(*) FILTER (WHERE sr.outcome='hit')     AS hits,
          count(*) FILTER (WHERE sr.outcome='partial') AS partials,
          count(*) FILTER (WHERE sr.outcome='miss')    AS misses
        FROM keys k JOIN claim_scores sr ON sr.unit_id = k.id
        WHERE k.asset = %(asset)s GROUP BY k.creator_id
    )
    SELECT k.creator_id, cr.name AS creator,
      count(*) AS units,
      count(*) FILTER (WHERE k.kind='claim') AS claims,
      max(k.published_at) AS last_seen,
      COALESCE(s.scored,0) AS scored, COALESCE(s.hits,0) AS hits,
      COALESCE(s.partials,0) AS partials, COALESCE(s.misses,0) AS misses
    FROM keys k
    JOIN creators cr ON cr.id = k.creator_id
    LEFT JOIN sc s ON s.creator_id = k.creator_id
    WHERE k.asset = %(asset)s
    GROUP BY k.creator_id, cr.name, s.scored, s.hits, s.partials, s.misses
    ORDER BY units DESC, cr.name
    """
    with pool.connection() as conn:
        rows = conn.execute(sql, _one_asset_params(asset_id)).fetchall()
    for r in rows:
        r["hit_rate"] = hit_rate(r["hits"], r["partials"], r["misses"])
    return rows


def open_claims(pool: ConnectionPool, asset_id: str, limit: int = 60) -> list[dict[str, Any]]:
    """未到期判断：还没兑现的那些，按到期日升序。

    产品里目前**没有任何视图回答"什么还没兑现"**——验证中心只给全局的即将到期队列。
    这是标的页最有决策价值的一块，所以判据 `success_def` 原样带出，前端不许截断。
    """
    sql = f"""
    {_KEYS_SCOPED}
    SELECT u.id AS unit_id, ladder.label AS horizon_label, u.quote, u.payload,
           u.published_at, u.ref_price_at_publish, u.tags,
           cr.name AS creator, c.id AS content_id, c.title AS content_title
    FROM keys k
    JOIN knowledge_units u ON u.id = k.id
    JOIN creators cr ON cr.id = u.creator_id
    JOIN contents c ON c.id = u.content_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(u.payload->'scoring_spec'->'eval_ladder', '[]'::jsonb)) AS ladder(label)
    WHERE k.asset = %(asset)s AND k.kind='claim'
      AND ladder.label ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$'
      AND ladder.label::date >= current_date
      AND NOT EXISTS (SELECT 1 FROM claim_scores s
                      WHERE s.unit_id = u.id AND s.horizon_label = ladder.label)
    ORDER BY ladder.label, u.published_at DESC NULLS LAST
    LIMIT %(limit)s
    """
    with pool.connection() as conn:
        return conn.execute(sql, {**_one_asset_params(asset_id), "limit": limit}).fetchall()


def settled_claims(pool: ConnectionPool, asset_id: str, limit: int = 60) -> list[dict[str, Any]]:
    """已判定记录：市场对这个标的的裁决流，按判定时点倒序。"""
    sql = f"""
    {_KEYS_SCOPED}
    SELECT s.id AS score_id, s.unit_id, s.horizon_label, s.outcome, s.realized, s.eval_ts,
           u.quote, u.payload, u.published_at, u.ref_price_at_publish,
           cr.name AS creator, c.id AS content_id, c.title AS content_title
    FROM keys k
    JOIN claim_scores s ON s.unit_id = k.id
    JOIN knowledge_units u ON u.id = k.id
    JOIN creators cr ON cr.id = u.creator_id
    JOIN contents c ON c.id = u.content_id
    WHERE k.asset = %(asset)s
    ORDER BY s.eval_ts DESC, s.id DESC
    LIMIT %(limit)s
    """
    with pool.connection() as conn:
        return conn.execute(sql, {**_one_asset_params(asset_id), "limit": limit}).fetchall()


def nodes_for_asset(pool: ConnectionPool, asset_id: str, limit: int = 60) -> list[dict[str, Any]]:
    """挂着该资产标签的规范知识节点（沉淀层的入口）。"""
    sql = """
    SELECT n.id, n.kind, n.title, n.canonical, n.status, n.tags, n.notes, n.updated_at,
           (SELECT count(*) FROM node_attestations a WHERE a.node_id=n.id) AS n_attest,
           (SELECT count(DISTINCT u.creator_id) FROM node_attestations a
              JOIN knowledge_units u ON u.id=a.unit_id WHERE a.node_id=n.id) AS n_creators
    FROM knowledge_nodes n
    WHERE EXISTS (SELECT 1 FROM unnest(n.tags) t WHERE upper(t) = ANY(%(tags)s))
    ORDER BY n_attest DESC, n.updated_at DESC
    LIMIT %(limit)s
    """
    with pool.connection() as conn:
        return conn.execute(sql, {**_one_asset_params(asset_id), "limit": limit}).fetchall()


def disagreements(pool: ConnectionPool, asset_id: str) -> dict[str, list[dict[str, Any]]]:
    """分歧与改口——这个标的上最值得读的一段。

    两类：①节点间的关系边（conflicts=对立，relates=互补）；
    ②提及关系里的 `supersedes`（作者改口）与 `contradicts`（被反驳）。
    """
    node_sql = """
    SELECT n.id FROM knowledge_nodes n
    WHERE EXISTS (SELECT 1 FROM unnest(n.tags) t WHERE upper(t) = ANY(%(tags)s))
    """
    rel_sql = f"""
    WITH tagged AS ({node_sql})
    SELECT r.id, r.relation, r.note, r.a_node, r.b_node,
           a.title AS a_title, a.canonical AS a_canonical, a.status AS a_status,
           b.title AS b_title, b.canonical AS b_canonical, b.status AS b_status
    FROM node_relations r
    JOIN knowledge_nodes a ON a.id = r.a_node
    JOIN knowledge_nodes b ON b.id = r.b_node
    WHERE r.a_node IN (SELECT id FROM tagged) OR r.b_node IN (SELECT id FROM tagged)
    ORDER BY (r.relation='conflicts') DESC, r.id
    """
    evo_sql = f"""
    WITH tagged AS ({node_sql})
    SELECT at.node_id, at.relation, at.note, n.title AS node_title,
           u.id AS unit_id, u.quote, u.published_at, cr.name AS creator,
           c.id AS content_id, c.title AS content_title
    FROM node_attestations at
    JOIN knowledge_nodes n ON n.id = at.node_id
    JOIN knowledge_units u ON u.id = at.unit_id
    JOIN creators cr ON cr.id = u.creator_id
    JOIN contents c ON c.id = u.content_id
    WHERE at.node_id IN (SELECT id FROM tagged)
      AND at.relation IN ('supersedes', 'contradicts')
    ORDER BY u.published_at DESC NULLS LAST, u.id DESC
    """
    params = _one_asset_params(asset_id)
    with pool.connection() as conn:
        return {"relations": conn.execute(rel_sql, params).fetchall(),
                "evolution": conn.execute(evo_sql, params).fetchall()}


def related_assets(pool: ConnectionPool, asset_id: str, limit: int = 12) -> list[dict[str, Any]]:
    """共同出现的标的：同一条单元里一起被提到的，按共现次数排序。

    "半导体这条线上还有谁"——比人工维护一张关联表可靠，因为它就是语料自己说的。
    """
    # 这里**不能**用 scoped：要的是"这个标的的单元上还挂了哪些别的标的"，
    # 展开必须是全量的，只是外层限定起点。
    sql = f"""
    {_KEYS_CTE}
    SELECT other.asset, count(*) AS co_mentions
    FROM keys k JOIN keys other ON other.id = k.id AND other.asset <> k.asset
    WHERE k.asset = %(asset)s
    GROUP BY other.asset ORDER BY co_mentions DESC, other.asset
    LIMIT %(limit)s
    """
    with pool.connection() as conn:
        rows = conn.execute(sql, {**_one_asset_params(asset_id), "limit": limit}).fetchall()
    for r in rows:
        a = assets.lookup(r["asset"])
        r["display"] = a.display if a else None
        r["asset_class"] = a.asset_class if a else None
    return rows


def gather(pool: ConnectionPool, jobs: dict[str, Callable[[], Any]]) -> dict[str, Any]:
    """并发跑一组互不依赖的只读查询。

    **瓶颈是往返次数，不是 SQL。** 本机经 SSH 隧道连服务器库时单程约 300ms，档案页十几条
    查询串起来就是 5 秒多，而每条查询本身只要几毫秒（实测 `coverage_for` 只返回一行也要
    279ms）。池子 max_size=10，并发两波就跑完。服务器上库在本地（往返 ~1ms），并发也不会更慢。

    每个 job 自己 `with pool.connection()` 取连接，线程之间不共享连接。
    """
    if not jobs:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as workers:
        futures = {key: workers.submit(fn) for key, fn in jobs.items()}
        return {key: future.result() for key, future in futures.items()}


def asset_dossier(pool: ConnectionPool, asset_id: str) -> dict[str, Any] | None:
    """标的档案：页面首屏需要的全部聚合。库里一条单元都没有的标的返回 None。"""
    canonical = assets.resolve_id(asset_id) or asset_id.strip().upper()
    # summary 也一起并发跑：它只是用来判"有没有单元"，为它单开一个往返不值当
    # （多跑的那几条在没有单元时结果都是空，代价可忽略）。
    parts = gather(pool, {
        "summary": lambda: asset_summary(pool, canonical),
        "by_creator": lambda: by_creator(pool, canonical),
        "open_claims": lambda: open_claims(pool, canonical),
        "settled_claims": lambda: settled_claims(pool, canonical),
        "nodes": lambda: nodes_for_asset(pool, canonical),
        "disagreements": lambda: disagreements(pool, canonical),
        "related_assets": lambda: related_assets(pool, canonical),
    })
    summary = parts.pop("summary")
    if summary is None:
        return None
    a = assets.lookup(canonical)
    return {
        "asset": canonical,
        "identity": {
            "id": canonical,
            "display": a.display if a else None,
            "asset_class": a.asset_class if a else None,
            "class_label": assets.CLASS_LABELS.get(a.asset_class) if a else None,
            "tag": a.tag if a else canonical.lower(),
            "aliases": list(a.aliases) if a else [],
            "related": list(a.related) if a else [],
            "note": a.note if a else "",
            "registered": a is not None,
        },
        "coverage": {
            "bars": bool(a and (a.yf or a.fred)),
            "bars_note": (a.yf_note if a else "") or "",
            "metrics": (a.metric_symbol if a else None),
            "instrument": (a.instrument if a else None),
        },
        "summary": summary,
        **parts,
    }
