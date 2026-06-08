"""PostgreSQL 连接池（psycopg3）：对话存储与行情存储共用同一个池。

单用户本地工具，池子开小即可；row_factory=dict_row 让查询结果像 dict 一样取用，
与原 sqlite3.Row 行为一致（既能 r["x"] 也能 dict(r)）。
"""

from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def make_pool(conninfo: str, *, min_size: int = 1, max_size: int = 10) -> ConnectionPool:
    """创建并打开连接池。调用方负责在进程退出时 pool.close()。"""
    return ConnectionPool(
        conninfo,
        min_size=min_size,
        max_size=max_size,
        kwargs={"row_factory": dict_row, "autocommit": False},
        open=True,
    )
