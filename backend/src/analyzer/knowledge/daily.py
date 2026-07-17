"""知识引擎每日维护：行情刷新 → 到期评分 → 节点状态重算（幂等，挂在 collector 调度）。

等价于手动跑 prices / scorers / nodes recompute 三条 CLI；任何一步失败不影响后续
（best-effort，scheduler 的 job 约定）。也可单独跑：python -m analyzer.knowledge.daily
"""

from __future__ import annotations

import datetime as dt
import logging

from ..config import get_settings
from ..db import make_pool
from . import prices, scorers
from .nodes import NodeStore

log = logging.getLogger("analyzer.knowledge")

SINCE = dt.date(2026, 5, 1)   # 语料最早发布日前的固定起点（幂等 upsert，不必滚动）


def run_daily(pool) -> None:
    try:
        prices.refresh(pool, since=SINCE)
    except Exception:
        log.exception("知识引擎日维护：行情刷新失败（继续评分）")
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


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        run_daily(pool)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
