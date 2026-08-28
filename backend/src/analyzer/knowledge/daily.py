"""知识引擎每日维护：**自动摄取** → 行情 → 盈利预期修正 → 到期评分 → 节点状态重算 →
补齐缺帧（幂等，挂 collector）。

摄取窗口按缺口算而不是固定天数：每个信源回看"最新一期距今多少天"（`ingest_since_days`），
库里没有该信源时回看 30 天。固定窗口在断更或断网之后会漏掉中间那几期。

等价于手动跑 backfill_transcripts×3 / prices / estimates / scorers / nodes recompute /
backfill_keyframes 六条 CLI；
任何一步失败不影响后续（best-effort，scheduler 的 job 约定）。
也可单独跑：python -m analyzer.knowledge.daily
"""

from __future__ import annotations

import datetime as dt
import logging

from ..config import get_settings
from ..db import make_pool
from . import backfill_keyframes, backfill_transcripts, estimates, prices, scorers
from .nodes import NodeStore
from .store import KnowledgeStore

log = logging.getLogger("analyzer.knowledge")

SINCE_FLOOR = dt.date(2026, 5, 1)   # 语料为空时的兜底起点
SINCE_LEAD_DAYS = 30                # 行情要比最早那期再往前留出的缓冲
KEYFRAME_GAP_LIMIT = 20       # 每日最多补几条内容的帧（别让日维护变成长批处理）

# 摄取新内容：窗口按**缺口**算，不用固定天数。
# 固定窗口（比如"近 3 天"）有个静默失效的模式：collector 停机或转录连续失败超过窗口长度，
# 中间那几期就永久漏掉了，而且事后没有任何迹象——频道清单里它们仍在，库里却永远不会有。
# 改成"从该信源最新一期的发布日算到现在"，停多久就补多久，自愈。
INGEST_HANDLES = ["@andyleegogo", "@MeiTouJun", "@yttalkjun"]
INGEST_MIN_DAYS = 2      # 下限：至少回看两天，容忍发布时间与抓取时间的时区差
INGEST_MAX_NEW = 5       # 每信源每轮上限。缺口很大时分几天追平，而不是一轮拉满


def ingest_since_days(pool, handle: str, *, now: dt.datetime | None = None) -> int:
    """该信源"最新一期距今多少天"，即需要回看的窗口。库里没有该信源的内容时回看 30 天。"""
    now = now or dt.datetime.now(dt.timezone.utc)
    with pool.connection() as conn:
        row = conn.execute(
            """SELECT max(c.published_at) AS last FROM contents c
               JOIN creator_handles h ON h.creator_id = c.creator_id
               WHERE h.handle = %s""", (handle,)).fetchone()
    last = row and row["last"]
    if last is None:
        return 30
    return max(INGEST_MIN_DAYS, (now - last).days + 1)


def price_since(pool) -> dt.date:
    """行情起点跟着语料走：最早那期发布日再往前 30 天。

    原先是硬编码 2026-05-01（定它时语料最早 05-18）。2026-08-18 往前回填 Andy 到
    03-28，这个常量没跟着动 —— 回填内容的 claim 会整批落在行情覆盖之外：ref_price
    回查不到、到期也评不了分，而且不报错，只是静静地少一批观测。跟着语料推就不会再
    失配；upsert 幂等，起点前移只是多拉一段历史。
    """
    with pool.connection() as conn:
        row = conn.execute("SELECT min(published_at)::date AS d FROM contents").fetchone()
    earliest = (row or {}).get("d")
    if earliest is None:
        return SINCE_FLOOR
    return min(earliest - dt.timedelta(days=SINCE_LEAD_DAYS), SINCE_FLOOR)


def run_daily(pool) -> None:
    # 摄取放最前：当天新入库的内容当天就能进后续环节（提帧、周报计数）。
    # L1 提取仍是手动的（会话按 extraction-guide 产 JSON），这里只保证 L0 不丢——
    # 视频删了就永远没了，而 L0 是整条链的地基。
    for handle in INGEST_HANDLES:
        try:
            days = ingest_since_days(pool, handle)
            log.info("知识引擎日维护：%s 回看 %d 天", handle, days)
            backfill_transcripts.run(handle, since_days=days, max_new=INGEST_MAX_NEW)
        except Exception:
            log.exception("知识引擎日维护：%s 摄取失败（继续下一个信源）", handle)

    try:
        prices.refresh(pool, since=price_since(pool))
    except Exception:
        log.exception("知识引擎日维护：行情刷新失败（继续评分）")
    try:
        # 盈利预期修正：良性去估值（倍数压、盈利涨）与戴维斯双杀的分界指标，领先价格。
        # 放在评分之前只是顺序习惯，两者不耦合。
        st = estimates.refresh(pool)
        log.info("知识引擎日维护：盈利预期修正入库 %d/%d", st["stored"], st["tried"])
    except Exception:
        log.exception("知识引擎日维护：盈利预期修正失败（继续评分）")
    try:
        scorers.run(dry=False)
    except Exception:
        log.exception("知识引擎日维护：评分失败（继续重算状态）")
    try:
        changed = NodeStore(pool).recompute()
        if changed:
            log.info("知识引擎日维护：节点状态变化 %s", changed)
    except Exception:
        log.exception("知识引擎日维护：节点状态重算失败")
    try:
        # 提帧的墙会来回动：墙起时摄取的内容一帧都没有，落下后在这里自动补上
        n = backfill_keyframes.fill_gaps(KnowledgeStore(pool), limit=KEYFRAME_GAP_LIMIT)
        if n:
            log.info("知识引擎日维护：补齐关键帧 %d 张", n)
    except Exception:
        log.exception("知识引擎日维护：关键帧补齐失败")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        run_daily(pool)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
