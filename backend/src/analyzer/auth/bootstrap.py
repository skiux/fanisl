"""创建第一个管理员。

系统里一个用户都没有时，没有任何 HTTP 路径能建出管理员——`/admin/users` 自己就要求
管理员身份。这是有意的：不留"首次访问自动成为管理员"那种后门，否则从服务上线到你打开
浏览器之间的任何时刻，谁先到谁就是管理员。

用法（在服务器上，backend/ 目录下）：

    .venv/bin/python -m analyzer.auth.bootstrap alice

口令从终端交互读取，不走命令行参数——参数会留在 shell history 和 `ps` 的输出里。
已经存在同名用户时不覆盖，只提示。

**库指向远端时默认拒绝执行。** 开发机上 `PG_CONNINFO` 常常指着 5433 那条通到生产的
隧道，而这条命令是往 users 表里写东西的——照着文档敲一遍就会在生产库里多出一个账号
（真发生过）。要故意对生产执行，加 `--remote`。
"""

from __future__ import annotations

import getpass
import sys

from ..db import describe_conninfo
from ..runtime import settings, user_store
from .passwords import hash_password
from .store import UserExists, normalize_username


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    allow_remote = "--remote" in argv
    argv = [a for a in argv if a != "--remote"]
    if len(argv) != 1:
        print("用法: python -m analyzer.auth.bootstrap [--remote] <用户名>", file=sys.stderr)
        return 2

    where, local = describe_conninfo(settings.pg_conninfo)
    if not local and not allow_remote:
        print(f"拒绝执行：库是 {where}，不是本机。\n"
              f"这条命令会往 users 表里写数据。开发机上 PG_CONNINFO 常指着 5433 那条\n"
              f"通到生产的隧道，照着敲一遍就会在生产库里建出账号。\n"
              f"  · 本地开发：PG_CONNINFO=\"dbname=fanisl_dev\" 再跑（见 backend/README.md）\n"
              f"  · 确实要建到 {where}：加 --remote",
              file=sys.stderr)
        return 2

    username = normalize_username(argv[0])

    existing = user_store.get_by_username(username)
    if existing is not None:
        print(f"用户 {username} 已存在（角色 {existing['role']}）。"
              f"要改口令用 /admin/users/{existing['id']}/password。", file=sys.stderr)
        return 1

    password = getpass.getpass("设置口令: ")
    if len(password) < settings.auth_min_password_len:
        print(f"口令至少 {settings.auth_min_password_len} 位", file=sys.stderr)
        return 1
    if password != getpass.getpass("再输一次: "):
        print("两次输入不一致", file=sys.stderr)
        return 1

    try:
        row = user_store.create_user(username, hash_password(password), role="admin")
    except UserExists:
        print("用户名已被占用", file=sys.stderr)
        return 1
    print(f"已创建管理员 {row['username']}（id={row['id']}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
