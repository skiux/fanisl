"""极简后台调度：一个守护线程按各 job 的 interval 到点触发。无新依赖、无 shell 脚本。

job 自身负责 best-effort 与日志（collector 已做）；这里只管"到点就调"。
启动时立即跑一遍（让前端马上有数据），之后按 interval 周期跑；shutdown 时停止。
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
        now = time.monotonic()
        for j in self._jobs:
            j["next"] = now if self._run_immediately else now + j["interval"]
        while not self._stop.is_set():
            now = time.monotonic()
            for j in self._jobs:
                if now >= j["next"]:
                    try:
                        j["fn"]()
                    except Exception:  # noqa: BLE001 — job 内部已记日志，调度不崩
                        pass
                    j["next"] = time.monotonic() + j["interval"]
            self._stop.wait(self._tick)
