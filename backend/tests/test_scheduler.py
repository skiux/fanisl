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


def test_uses_wall_clock_not_monotonic(monkeypatch):
    """睡眠期间 time.monotonic() 不走字（macOS 实测），到期判定必须看墙钟。"""
    import analyzer.scheduler as sched_mod

    wall = [1_000_000.0]
    monkeypatch.setattr(sched_mod.time, "time", lambda: wall[0])
    monkeypatch.setattr(sched_mod.time, "monotonic", lambda: 500.0)  # 冻住：模拟机器在睡

    calls = []
    sch = Scheduler([("daily", 86400, lambda: calls.append(1))], tick_s=0.01)
    sch.start()
    time.sleep(0.05)
    assert len(calls) == 1                     # 启动那次

    wall[0] += 86400                           # 墙钟过了一天（其间机器一直在睡）
    time.sleep(0.05)
    sch.stop()
    assert len(calls) == 2, "墙钟已过一个 interval，即使 monotonic 没动也该触发"


def test_backward_clock_jump_does_not_starve_job(monkeypatch):
    """系统时钟被往回调时，next 不应被甩到远future 把任务饿死。"""
    import analyzer.scheduler as sched_mod

    wall = [1_000_000.0]
    monkeypatch.setattr(sched_mod.time, "time", lambda: wall[0])

    calls = []
    sch = Scheduler([("j", 60, lambda: calls.append(1))], tick_s=0.01)
    sch.start()
    time.sleep(0.05)
    assert len(calls) == 1                     # next = now+60

    wall[0] -= 86400                           # 时钟往回跳一天：next 变成 86460 秒之后
    time.sleep(0.05)                           # 钳制应把 next 拉回 now+60
    wall[0] += 61
    time.sleep(0.05)
    sch.stop()
    assert len(calls) == 2, "回调时钟后任务应在一个 interval 内恢复触发，而不是等一天"
