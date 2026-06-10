"""后台 worker 公共设施：单实例守卫 + 信号驱动的前台运行。

服务拆分后 collector / trader 各为独立进程。两者都**必须单实例**（跑两份=重复采集/
重复自主下单），用 PostgreSQL 会话级 advisory lock 防呆：第二个实例取不到锁即退出。
"""

from __future__ import annotations

import signal
import threading

from psycopg_pool import ConnectionPool

from .scheduler import Scheduler

# advisory lock 键（任意常量，区分不同 worker）
LOCK_COLLECTOR = 0x66616E01  # 'fan' + 01
LOCK_TRADER = 0x66616E02

# 持有锁的连接必须**全程保活**：会话级 advisory lock 随连接(会话)存续，连接一旦被 GC/关闭
# 锁就释放。所以把连接挂到模块级，防止离开作用域后被回收。
_held_locks: list = []


def acquire_single_instance(pool: ConnectionPool, key: int, name: str) -> None:
    """取一把会话级 advisory lock 并**永久持有**（故意不归还连接）。取不到说明已有实例在跑。"""
    conn = pool.getconn()
    conn.autocommit = True  # 锁随会话存续，不要卡在未提交事务里
    row = conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (key,)).fetchone()
    ok = row["ok"] if isinstance(row, dict) else row[0]
    if not ok:
        pool.putconn(conn)
        raise SystemExit(f"[{name}] 已有同类 worker 在运行（advisory lock {key:#x} 未取得），退出。")
    _held_locks.append(conn)  # 保活，绝不归还/释放


def run_workers(schedulers: list[Scheduler], name: str = "worker") -> None:
    """启动所有调度器，阻塞到收到 SIGINT/SIGTERM，再优雅停掉。"""
    stop = threading.Event()
    for s in schedulers:
        s.start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    print(f"[{name}] 已启动 {len(schedulers)} 个调度器，等待退出信号…", flush=True)
    try:
        stop.wait()
    finally:
        for s in schedulers:
            s.stop()
        print(f"[{name}] 已停止。", flush=True)
