"""PostgreSQL 连接池（psycopg3）：对话存储与行情存储共用同一个池。

单用户本地工具，池子开小即可；row_factory=dict_row 让查询结果像 dict 一样取用，
与原 sqlite3.Row 行为一致（既能 r["x"] 也能 dict(r)）。
"""

from __future__ import annotations

import os
import sys

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def make_pool(conninfo: str, *, min_size: int = 1, max_size: int = 10) -> ConnectionPool:
    """创建并打开连接池。调用方负责在进程退出时 pool.close()。

    **建池就说一声连的是哪个库。** 服务类入口有启动横幅，而知识引擎那批 CLI
    （提取 / 归并 / 关系边）自建池、不走 runtime，跑起来一句都不说——它们连的
    往往正是经隧道的生产库。这一行印在最前面，省掉"我刚才那条命令写到哪去了"。
    """
    where, local = describe_conninfo(conninfo)
    print(f"[fanisl] 连库 {where}{'' if local else '  ← 远端'}", file=sys.stderr, flush=True)
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

    **解析照 libpq 的规则来，不自己按空格切。** 原先手写的切分只认 `key=value`，
    2026-09-13 实测三种合法写法都被判成本机、守卫形同虚设：URI `postgresql://…@127.0.0.1:5433/…`、
    等号两边带空格的 `port = 5433`、只写 `hostaddr=`。连接串里没写的项 libpq 会去读
    PGHOSTADDR / PGHOST / PGPORT 环境变量，这里跟着读；`hostaddr` 与 `host` 都有时真正连的是
    前者。解析不了、或列了多个主机的一律按远端算——守卫宁可误拦，不可放行。
    """
    try:
        fields = conninfo_to_dict(conninfo)
    except psycopg.ProgrammingError:
        return "（无法解析的连接串）", False
    env = os.environ.get
    host = fields.get("hostaddr") or env("PGHOSTADDR") or fields.get("host") or env("PGHOST") or ""
    port = str(fields.get("port") or env("PGPORT") or "5432")
    name = fields.get("dbname") or env("PGDATABASE") or "?"
    where = f"{host}:{port}" if host else "本机 socket"
    local = port == "5432" and "," not in host and (
        host in ("", "localhost", "::1") or host.startswith(("127.", "/")))
    return f"{name}@{where}", local
