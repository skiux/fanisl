"""知识引擎每日维护：行情 → 盈利预期修正 → 到期评分 → 节点状态重算 → 补齐缺帧（幂等，挂 collector）。

等价于手动跑 prices / estimates / scorers / nodes recompute / backfill_keyframes 五条 CLI；
任何一步失败不影响后续（best-effort，scheduler 的 job 约定）。
也可单独跑：python -m analyzer.knowledge.daily
"""

from __future__ import annotations

import datetime as dt
import logging

from ..config import get_settings
from ..db import make_pool
from . import backfill_keyframes, estimates, prices, scorers
from .nodes import NodeStore
from .store import KnowledgeStore

log = logging.getLogger("analyzer.knowledge")

SINCE_FLOOR = dt.date(2026, 5, 1)   # 语料为空时的兜底起点
SINCE_LEAD_DAYS = 30                # 行情要比最早那期再往前留出的缓冲
KEYFRAME_GAP_LIMIT = 20       # 每日最多补几条内容的帧（别让日维护变成长批处理）


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
