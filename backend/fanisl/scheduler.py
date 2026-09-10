"""极简后台调度：一个守护线程按各 job 的 interval 到点触发。无新依赖、无 shell 脚本。

job 自身负责 best-effort 与日志（collector 已做）；这里只管"到点就调"。
启动时立即跑一遍（让前端马上有数据），之后按 interval 周期跑；shutdown 时停止。

**计时用墙钟而不是 time.monotonic()**：macOS 上 time.monotonic() 走 mach_absolute_time()，
睡眠期间不走字（Linux 的 CLOCK_MONOTONIC 同样不含 suspend）。开发机实测开机 9.2 天里只
清醒 52%，interval=86400 的"每日"任务因此要约 46 小时墙钟才触发一次，且误差会一直累积。
我们要的语义是"每过 N 秒真实时间"，那就得用墙钟。代价是系统时钟被改会影响下次触发，
下面用一个上界钳制兜住（往回调时不至于把任务饿死）。
"""

from __future__ import annotations

import threading
import time
from typing import Callable


class Scheduler:
    def __init__(
        self,
        jobs: list[tuple[str, int, Callable[[], None]]],
        tick_s: float = 5.0,
        run_immediately: bool = True,
    ) -> None:
        self._jobs = [{"name": n, "interval": i, "fn": f, "next": 0.0} for n, i, f in jobs]
        self._tick = tick_s
        self._run_immediately = run_immediately
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="collector", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=10.0)

    def _loop(self) -> None:
        now = time.time()
        for j in self._jobs:
            j["next"] = now if self._run_immediately else now + j["interval"]
        while not self._stop.is_set():
            now = time.time()
            for j in self._jobs:
                if now >= j["next"]:
                    try:
                        j["fn"]()
                    except Exception:  # noqa: BLE001 — job 内部已记日志，调度不崩
                        pass
                    j["next"] = time.time() + j["interval"]
                elif j["next"] - now > j["interval"]:
                    # 墙钟被往回调过，next 被甩到了太远的将来——拉回一个 interval 内，
                    # 否则任务会被饿死到时钟差值走完为止
                    j["next"] = now + j["interval"]
            self._stop.wait(self._tick)
