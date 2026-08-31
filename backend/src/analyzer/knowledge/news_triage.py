"""动态的降噪与摘要：先确定性预筛，再 LLM 判相关。

**为什么要这一层**（2026-08-31 对 2891 条实测）：Finnhub 的 `related` 是"沾边"不是"关于"——
只有 **18%** 的标题提到该 ticker；67 篇稿子被挂到 ≥5 个标的（占 440 行）；
ChartMill 那 213 条是纯盘面流水（"今日最活跃""道指异动"）。不筛这一节读不动。

**分两层，顺序不能反**：
1. **确定性规则**（本文件上半）：整源黑名单、一稿多投、榜单标题。免费、可审计、可复现，
   先把明显的垃圾挡掉，不必花钱让模型读它们。
   三条规则都带同一个例外——**标题点名了这个标的就留下**，宁可多留不可错杀。
2. **LLM 判相关**（下半）：问的不是"这条是不是噪音"，而是
   **"对这个标的尚未兑现的那几条判断，是不是新信息"**——该标的的未到期 claim 一起进提示词。
   顺带出一句中文（这是个中文产品，标题却全是英文）。

**边界：LLM 只做筛与摘，绝不参与判定。** 验证层零 LLM 是这个产品可信的根，
新闻这块方便也不能破。降噪结果写在 `news_items.relevance`，**原始记录一条不删**——
规则会改，改了要能对存量重判。
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from psycopg_pool import ConnectionPool

from .. import assets

log = logging.getLogger("analyzer.knowledge.news_triage")

# 整源丢弃：只产盘面流水，没有一条有信息量（实测 213 条无一例外）
NOISE_SOURCES = {"chartmill"}
# 同一篇稿子挂到这么多标的以上，就不是"关于"某个标的了
CROSS_POST_LIMIT = 5
# 榜单/综述/异动播报的标题模式
ROUNDUP = re.compile(
    r"(most active|biggest movers?|top (gainers|losers)|movers?\b|what's going on"
    r"|market wrap|premarket|session:|watchlist|whale activity"
    r"|stocks? (investors|traders|to watch)|what moved markets|brunch"
    r"|this week on wall street|analyst ratings changes)", re.I)

RELEVANCE = ("core", "context", "noise")


def _mentions(title: str, asset: str, names: tuple[str, ...]) -> bool:
    """标题点名了这个标的没有？ticker 按词匹配，公司名取首词（Nvidia / Broadcom）。"""
    upper = title.upper()
    if re.search(rf"\b{re.escape(asset)}\b", upper):
        return True
    return any(name and name.upper() in upper for name in names)


def rule_verdict(item: dict, *, asset: str, names: tuple[str, ...],
                 cross_posts: int) -> str | None:
    """确定性规则的判决；拿不准返回 None，交给 LLM。

    三条规则共用一个例外：**标题点名了这个标的就留下**。宁可多留一条噪音，
    也不要因为一条规则把"英伟达重申增长指引"这种正经消息误杀。

    一稿多投判 **context 而不是 noise**：那多半是行业/主题稿，对这个标的不是"关于"、
    但常常是有用的背景。实测把它一刀切成 noise 会误杀"The Memory Shortage Gets Worse
    In 2027"这种——存储涨价正是语料里几条判断的论据。
    """
    title = item.get("title") or ""
    if (item.get("source") or "").strip().lower() in NOISE_SOURCES:
        return "noise"
    named = _mentions(title, asset, names)
    if named:
        return None
    if ROUNDUP.search(title):
        return "noise"
    if cross_posts >= CROSS_POST_LIMIT:
        return "context"
    return None


def apply_rules(pool: ConnectionPool, *, only: str | None = None) -> dict[str, int]:
    """对未判的条目跑确定性规则。判不了的留 NULL，等 LLM。"""
    names_by_asset = _display_names(pool)
    with pool.connection() as conn:
        cross = {r["dedup_key"]: r["n"] for r in conn.execute(
            "SELECT dedup_key, count(DISTINCT asset) AS n FROM news_items "
            "GROUP BY dedup_key HAVING count(DISTINCT asset) > 1").fetchall()}
        rows = conn.execute(
            "SELECT id, asset, title, source, dedup_key FROM news_items "
            "WHERE relevance IS NULL" + (" AND asset=%s" if only else ""),
            (only,) if only else ()).fetchall()

    marked = 0
    with pool.connection() as conn:
        for row in rows:
            verdict = rule_verdict(row, asset=row["asset"],
                                   names=names_by_asset.get(row["asset"], ()),
                                   cross_posts=cross.get(row["dedup_key"], 1))
            if verdict is None:
                continue
            conn.execute(
                "UPDATE news_items SET relevance=%s, classifier='rules', classified_at=now() "
                "WHERE id=%s", (verdict, row["id"]))
            marked += 1
    return {"seen": len(rows), "marked": marked, "left": len(rows) - marked}


def _display_names(pool: ConnectionPool) -> dict[str, tuple[str, ...]]:
    """每个标的的可辨识名字：登记表中文名之外，公司英文名取首词（Nvidia Corp → Nvidia）。"""
    with pool.connection() as conn:
        profiles = conn.execute(
            "SELECT asset, name FROM asset_profiles WHERE name IS NOT NULL").fetchall()
    out: dict[str, tuple[str, ...]] = {}
    for row in profiles:
        head = (row["name"] or "").split()[0]
        if len(head) >= 3:
            out[row["asset"]] = (head,)
    for a in assets.all_assets():
        extra = tuple(x for x in (a.display,) if x)
        out[a.id] = out.get(a.id, ()) + extra
    return out


# --- LLM 判相关 --------------------------------------------------------------

_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "i": {"type": "integer"},
                    "relevance": {"type": "string", "enum": list(RELEVANCE)},
                    "note": {"type": "string"},
                },
                "required": ["i", "relevance", "note"],
            },
        }
    },
    "required": ["items"],
}

_PROMPT = """你在为一个投资研究工作台筛选新闻。给定一个资产标的、它当前**尚未兑现**的判断，
以及一批新闻标题，逐条判断这条新闻对**这个标的的决策**有多大关系。

relevance 三档，**按"这条的主语是谁"分**：
- core：**主语就是这个标的**——它自己的业绩/指引/产品/监管/产能/定价/人事/并购，
  或专门针对它的多空论证；也包括直接影响下面那几条未兑现判断成立与否的消息。
- context：与它相关但**主语是别人**——同业动向、板块与宏观、供应链、只是顺带提到它。
- noise：与它没有实质关系——榜单、盘面流水、纯情绪化标题、讲的完全是别家公司的事。

note：**一句中文**，说清这条讲了什么变化；判为 noise 时写空字符串。不要复述标题，不要加评论。

标的：{asset}
未兑现的判断：
{claims}

新闻（逐条给编号）：
{items}"""


def _claims_block(pool: ConnectionPool, asset: str) -> str:
    from .asset_view import open_claims

    rows = open_claims(pool, asset, limit=6)
    if not rows:
        return "（当前没有未兑现的判断，按「是否关于这个标的的实质消息」判即可）"
    lines = []
    for row in rows:
        spec = (row["payload"].get("scoring_spec") or {}).get("success_def") or ""
        lines.append(f"- 到期 {row['horizon_label']}：{spec[:120]}")
    return "\n".join(lines)


# 客户端按进程缓存：auto 通道每次构造都会去探一次 Vertex 的 token（一次 HTTP 往返 + 一条
# warning），一批一次就是几百次白跑。客户端本身无状态（token 缓存反而是它想要的）。
_CLIENT: dict[str, Any] = {}


def _call_llm(settings, prompt: str) -> tuple[Any, str]:
    """跑一次分类调用，返回 (解析后的 JSON, 分类器标识)。失败抛给调用方。

    两个后端同一套提示词与 schema。默认走 Claude 的便宜档——2026-08-31 实测本机
    两条 Gemini 通道都不通（Vertex 换 token 400 / AI Studio generateContent 400）。
    """
    if settings.news_triage_backend == "gemini":
        from .llm import make_client

        client = _CLIENT.get("gemini") or _CLIENT.setdefault("gemini", make_client(settings))
        return client.generate_json([{"text": prompt}], _SCHEMA), f"gemini:{client.model}"

    import anthropic

    client = anthropic.Anthropic(
        api_key=settings.anthropic_api_key, base_url=settings.anthropic_base_url or None,
        timeout=settings.anthropic_timeout_s, max_retries=settings.anthropic_max_retries)
    message = client.messages.create(
        model=settings.news_triage_model, max_tokens=4000,
        messages=[{"role": "user", "content": prompt + "\n\n只输出 JSON，形如 "
                   '{"items":[{"i":0,"relevance":"core|context|noise","note":"一句中文"}]}'}])
    text = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")
    return _parse_json(text), f"claude:{settings.news_triage_model}"


def _parse_json(text: str) -> Any:
    """容忍模型把 JSON 包在 ``` 里或前后带话。"""
    import json

    body = text.strip()
    if "```" in body:
        body = body.split("```")[1]
        body = body[4:] if body.lower().startswith("json") else body
    start, end = body.find("{"), body.rfind("}")
    return json.loads(body[start:end + 1]) if start >= 0 < end else None


def classify_with_llm(pool: ConnectionPool, settings, *, asset: str,
                      batch: int = 20, limit: int = 200) -> dict[str, int]:
    """对某标的还没判的条目跑 LLM。调用失败就留 NULL——页面照常显示未判的，不会变空。"""
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, title, summary FROM news_items "
            "WHERE asset=%s AND relevance IS NULL ORDER BY published_at DESC LIMIT %s",
            (asset, limit)).fetchall()
    if not rows:
        return {"seen": 0, "classified": 0, "failed_batches": 0}

    claims = _claims_block(pool, asset)
    label = assets.lookup(asset)
    name = f"{label.display or asset}（{asset}）" if label else asset
    done, failed = 0, 0
    pace = getattr(settings, "news_triage_pace_s", 0.0)
    for start in range(0, len(rows), batch):
        if start and pace:
            time.sleep(pace)   # 免费档有每分钟请求数上限，别把自己打成 429
        chunk = rows[start:start + batch]
        listing = "\n".join(
            f"{i}. {row['title']}" + (f" —— {(row['summary'] or '')[:160]}" if row["summary"] else "")
            for i, row in enumerate(chunk))
        prompt = _PROMPT.format(asset=name, claims=claims, items=listing)
        try:
            data, classifier = _call_llm(settings, prompt)
        except Exception:  # noqa: BLE001 — 判不了就留 NULL，页面照常显示未判的
            failed += 1
            continue
        done += _write(pool, chunk, data, classifier)
    return {"seen": len(rows), "classified": done, "failed_batches": failed}


def _write(pool: ConnectionPool, chunk: list[dict], data: Any, classifier: str) -> int:
    items = (data or {}).get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return 0
    written = 0
    with pool.connection() as conn:
        for entry in items:
            try:
                index = int(entry["i"])
                verdict = entry["relevance"]
            except (KeyError, TypeError, ValueError):
                continue
            if verdict not in RELEVANCE or not 0 <= index < len(chunk):
                continue
            conn.execute(
                "UPDATE news_items SET relevance=%s, note=%s, classifier=%s, classified_at=now() "
                "WHERE id=%s AND relevance IS NULL",
                (verdict, (entry.get("note") or "").strip()[:200] or None,
                 classifier, chunk[index]["id"]))
            written += 1
    return written


def run(pool, settings, *, only: str | None = None, use_llm: bool = True) -> dict:
    """完整一轮：先规则，再 LLM。挂 collector 与 CLI 都走这里。"""
    from .reference import ReferenceStore

    ReferenceStore(pool)   # 建表/加列的 DDL 归 store 管，这里只保证它跑过
    result = {"rules": apply_rules(pool, only=only)}
    if not use_llm:
        return result
    targets = [only] if only else _assets_with_unclassified(pool)
    llm = {"assets": 0, "classified": 0, "failed_batches": 0, "failed_assets": []}
    for asset in targets:
        # **按标的隔离失败**：这活儿经隧道跑十几分钟，隧道断一次就整轮白跑不可接受。
        # 判过的已经落库、没判的还是 NULL，所以整件事是可续跑的——再跑一遍就补上。
        try:
            got = classify_with_llm(pool, settings, asset=asset)
        except Exception as exc:  # noqa: BLE001
            log.warning("降噪 %s 失败（%s: %.100s），跳过，下一轮补", asset, type(exc).__name__, exc)
            llm["failed_assets"].append(asset)
            continue
        if got["seen"]:
            llm["assets"] += 1
            llm["classified"] += got["classified"]
            llm["failed_batches"] += got["failed_batches"]
    result["llm"] = llm
    return result


def _assets_with_unclassified(pool: ConnectionPool) -> list[str]:
    with pool.connection() as conn:
        return [r["asset"] for r in conn.execute(
            "SELECT asset, count(*) AS n FROM news_items WHERE relevance IS NULL "
            "GROUP BY asset ORDER BY n DESC").fetchall()]


def main() -> None:
    import sys

    from ..config import get_settings
    from ..db import make_pool

    args = sys.argv[1:]
    only = args[args.index("--asset") + 1].upper() if "--asset" in args else None
    settings = get_settings()
    pool = make_pool(settings.pg_knowledge_conninfo)
    try:
        print(run(pool, settings, only=only, use_llm="--rules-only" not in args))
    finally:
        pool.close()


if __name__ == "__main__":
    main()
