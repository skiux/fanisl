"""连的是哪个库——这件事必须看得见、并且拦得住。

开发机上 `PG_CONNINFO` 常常指着 `port=5433`，那是通到生产的 SSH 隧道。隧道本身是
有意的（提取/归并那条流程靠它），但跑本地服务时连着它，等于拿生产库做开发：
页面显示生产缓存的真实数字，而任何写入直接落在生产上。2026-09-02 就因此在生产库里
误建过一个账号。
"""

import ast
import pathlib

import pytest

from analyzer.db import describe_conninfo


def test_tunnel_is_not_local_even_though_the_host_is_127001():
    """两者的 host 都是 127.0.0.1，只有端口能分开——光看主机会把隧道当成本机。"""
    _, local = describe_conninfo("host=127.0.0.1 port=5433 dbname=fanisl user=fanisl")
    assert local is False
    # 生产服务器上没有 port，走默认 5432，那才是真的本机
    _, local = describe_conninfo("host=127.0.0.1 dbname=fanisl user=fanisl")
    assert local is True


def test_unix_socket_and_plain_dbname_are_local():
    for conninfo in ("dbname=fanisl_dev", "host=localhost dbname=x", "host=::1 dbname=x"):
        assert describe_conninfo(conninfo)[1] is True, conninfo


def test_remote_host_is_not_local():
    assert describe_conninfo("host=db.example.com dbname=fanisl")[1] is False


def test_password_never_appears_in_the_description():
    """这行字要打进启动日志，日志会被贴进聊天窗口和 issue。"""
    text, _ = describe_conninfo(
        "host=127.0.0.1 port=5433 dbname=fanisl user=fanisl password=hunter2")
    assert "hunter2" not in text
    assert text == "fanisl@127.0.0.1:5433"


def test_bootstrap_refuses_a_remote_database(monkeypatch, capsys):
    """建管理员这条命令会往 users 表写东西，默认不许对着远端跑。"""
    from analyzer.auth import bootstrap

    monkeypatch.setattr(bootstrap.settings, "pg_conninfo",
                        "host=127.0.0.1 port=5433 dbname=fanisl user=fanisl", raising=False)
    assert bootstrap.main(["someone"]) == 2
    err = capsys.readouterr().err
    assert "拒绝执行" in err and "--remote" in err


class _PastTheGuard(Exception):
    """越过库检查的标记。用它是为了不去碰真库——那依赖库里有什么。"""


def test_bootstrap_allows_remote_when_asked_explicitly(monkeypatch):
    """确实要对生产建账号时得说出来——挡住的是手滑，不是这条路本身。"""
    from analyzer.auth import bootstrap

    def boom(_username):
        raise _PastTheGuard

    monkeypatch.setattr(bootstrap.settings, "pg_conninfo",
                        "host=127.0.0.1 port=5433 dbname=fanisl", raising=False)
    monkeypatch.setattr(bootstrap.user_store, "get_by_username", boom)

    with pytest.raises(_PastTheGuard):
        bootstrap.main(["--remote", "someone"])


def test_service_entry_points_go_through_the_remote_guard():
    """**服务类**入口都要经过 runtime，也就都会被那道守卫拦住。

    守卫写在 `analyzer.runtime` 的模块级，只要 import 它就自动有保护。

    **这条测试不覆盖知识引擎那批 CLI**（`analyzer.knowledge.*`）：它们自己
    `make_pool(get_settings().pg_knowledge_conninfo)`，从不 import runtime，
    因此绕过守卫——那是**有意的**，提取 / 归并本来就要经隧道写生产的知识库
    （见 deploy/README.md 的运行形态）。下面那条测试守的是另一件事：
    它们只碰知识库，碰不到账户数据。
    """
    src = pathlib.Path(__file__).resolve().parents[1] / "src" / "analyzer"
    entries = ["main.py", "worker_collector.py", "worker_trader.py", "backfill.py"]
    for name in entries:
        tree = ast.parse((src / name).read_text())
        hits = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and (node.module or "").endswith("runtime")
        ] + [
            node for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module is None
            and any(a.name == "runtime" for a in node.names)
        ]
        assert hits, f"{name} 没有 import runtime——它连库时不会经过远端守卫"



def test_knowledge_clis_touch_only_the_knowledge_database():
    """提取那条流程连的是生产，但它够不到账户数据。

    `analyzer.knowledge.*` 里的 CLI 自建连接池、绕过远端守卫（有意的）。所以边界
    不能靠守卫，只能靠**它们只用 `pg_knowledge_conninfo`**：Binance 缓存、用户、
    会话都在 `pg_conninfo` 那个库里，两者不是同一个连接。

    这条测试守的就是这个边界——哪天有人在知识模块里顺手连了主库，这里会红。
    """
    src = pathlib.Path(__file__).resolve().parents[1] / "src" / "analyzer" / "knowledge"
    for path in sorted(src.glob("*.py")):
        text = path.read_text()
        for bad in ("pg_conninfo", "pg_trading_conninfo", "binance_cache", "user_store"):
            assert bad not in text, f"{path.name} 碰到了 {bad}——知识模块只该用知识库"
