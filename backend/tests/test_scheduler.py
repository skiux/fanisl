"""调度器单测：启动即跑一次 + 周期触发 + 干净停止（短 tick，不联网）。"""

import threading
import time

from analyzer.scheduler import Scheduler


def test_runs_immediately_and_stops():
    calls = []
    sch = Scheduler([("job", 3600, lambda: calls.append(1))], tick_s=0.05)
    sch.start()
    time.sleep(0.2)
    sch.stop()
    assert len(calls) == 1  # 启动立即跑一次；interval 很长不会再跑


def test_periodic_trigger():
    ev = threading.Event()
    calls = []

    def job():
        calls.append(1)
        if len(calls) >= 2:
            ev.set()

    sch = Scheduler([("job", 0, job)], tick_s=0.02, run_immediately=True)
    sch.start()
    fired = ev.wait(timeout=2.0)
    sch.stop()
    assert fired and len(calls) >= 2  # interval=0 → 每个 tick 都触发


def test_disabled_job_failure_does_not_crash():
    sch = Scheduler([("boom", 0, lambda: 1 / 0)], tick_s=0.02)
    sch.start()
    time.sleep(0.1)
    sch.stop()  # 不应抛异常（job 失败被吞）
