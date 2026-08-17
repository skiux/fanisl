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

SINCE = dt.date(2026, 5, 1)   # 语料最早发布日前的固定起点（幂等 upsert，不必滚动）
KEYFRAME_GAP_LIMIT = 20       # 每日最多补几条内容的帧（别让日维护变成长批处理）


def run_daily(pool) -> None:
    try:
        prices.refresh(pool, since=SINCE)
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
