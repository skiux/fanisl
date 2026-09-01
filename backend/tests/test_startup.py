"""API 进程必须能起来——不管 Binance 凭据配成什么样。

`analyzer.runtime` 是模块级单例，import 那一刻就建连接池、建客户端。所以**构造期的
任何异常都等于全站 502**，而且 nginx 只会给一句 Bad Gateway，完全指不到原因。

2026-09-02 线上真踩了一次：私钥用自己的账号建、chmod 600，服务以 fanisl 身份跑读不了
→ PermissionError → import 失败 → 全站 502。auto-update 脚本本来有 import 自检能拦住，
但那次是手动 git pull，绕过了它。

所以这条测试起独立进程验 import——同进程 import 一次就缓存了，验不出东西。
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

SRC = str(Path(__file__).resolve().parent.parent / "src")

# 各种能想到的配错方式。共同要求只有一条：**不许让进程起不来**。
BROKEN_CONFIGS = [
    pytest.param({}, id="什么都没配"),
    pytest.param({"BINANCE_API_KEY": "k"}, id="只有key没有secret"),
    pytest.param({"BINANCE_API_KEY": "k",
                  "BINANCE_PRIVATE_KEY_PATH": "/definitely/not/here.pem"},
                 id="私钥路径不存在"),
    pytest.param({"BINANCE_API_KEY": "k", "BINANCE_PRIVATE_KEY_PATH": "/tmp"},
                 id="私钥指向目录"),
    pytest.param({"BINANCE_API_KEY": "k", "BINANCE_API_SECRET": "s",
                  "BINANCE_PRIVATE_KEY_PATH": "/nope.pem"},
                 id="两样都配但私钥是坏的"),
]

_BOOT = """
import sys
sys.path.insert(0, {src!r})
import analyzer.config as cfg
_s = cfg.Settings(_env_file=None, pg_conninfo={db!r}, pg_trading_conninfo={db!r},
                  pg_knowledge_conninfo={db!r}, **{overrides!r})
cfg.get_settings = lambda: _s
import analyzer.main            # 起不来就在这里抛
print("BOOT_OK", analyzer.main.binance_client.credential_status)
"""


@pytest.mark.parametrize("overrides", BROKEN_CONFIGS)
def test_api_starts_regardless_of_binance_credentials(overrides, pool):
    db = os.environ.get("FANISL_TEST_CONNINFO", "dbname=fanisl_test")
    proc = subprocess.run(
        [sys.executable, "-c", _BOOT.format(src=SRC, db=db, overrides=overrides)],
        capture_output=True, text=True, timeout=120,
        # 清掉可能劫持配置的 shell 变量，与项目其余部分保持一致
        env={k: v for k, v in os.environ.items()
             if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL")},
    )
    assert "BOOT_OK" in proc.stdout, (
        f"配置 {overrides} 让 API 起不来了——线上表现就是全站 502。\n"
        f"stderr:\n{proc.stderr[-2000:]}")


def test_startup_banner_reports_credential_state(pool):
    """配错了不该崩，但必须在日志第一屏说出来。

    否则表现出来只是"资产页所有来源都 unauthorized"，排查方向会跑偏到 key 权限上，
    而真正的原因是文件读不了。
    """
    db = os.environ.get("FANISL_TEST_CONNINFO", "dbname=fanisl_test")
    proc = subprocess.run(
        [sys.executable, "-c", _BOOT.format(
            src=SRC, db=db,
            overrides={"BINANCE_API_KEY": "k",
                       "BINANCE_PRIVATE_KEY_PATH": "/definitely/not/here.pem"})],
        capture_output=True, text=True, timeout=120,
        env={k: v for k, v in os.environ.items()
             if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL")},
    )
    assert "BOOT_OK" in proc.stdout
    assert "binance key=" in proc.stdout
    assert "配置有误" in proc.stdout
    assert "[fanisl] auth=" in proc.stdout      # 鉴权开关也要看得见
