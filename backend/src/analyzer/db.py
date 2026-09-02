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


def describe_conninfo(conninfo: str) -> tuple[str, bool]:
    """conninfo → (给人看的一行, 是不是本机开发库)。**口令不出现在返回值里。**

    判定规则只看两件事：主机是不是本机、端口是不是默认的 5432。

    - 生产服务器上是 `host=127.0.0.1 dbname=fanisl ...`，没有 port，走默认 5432 → 本机
    - 开发机上是 `host=127.0.0.1 port=5433 ...`，那是通到生产的 SSH 隧道 → **不是本机**

    两者的 host 都是 127.0.0.1，所以光看主机分不出来，必须连端口一起看。
    """
    fields = {}
    for part in conninfo.split():
        key, _, value = part.partition("=")
        if value:
            fields[key.strip()] = value.strip()
    host = fields.get("host", "")
    port = fields.get("port", "5432")
    name = fields.get("dbname", "?")
    where = f"{host}:{port}" if host else "本机 socket"
    local = port == "5432" and host in ("", "127.0.0.1", "localhost", "::1", "/tmp")
    return f"{name}@{where}", local
