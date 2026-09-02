"""进程间共享的对象装配：api / collector / trader 三个入口都 import 这里。

把原本散在 main.py 的构造集中到这里，使后台 worker 不必 import FastAPI app。
模块级单例：import 即构造（每个进程各建一份自己的连接池/客户端，互不影响）。
"""

from __future__ import annotations

import atexit
import os
import threading

from .agent import Agent
from .auth.store import UserStore
from .binance.cache import SourceCache
from .binance.client import BinanceClient
from .config import get_settings
from .data.factory import build_catalysts, build_crypto_sentiment, build_resolver
from .db import describe_conninfo, make_pool
from .marketstore import MarketStore
from .storage import Storage
from .trading.engine import TradingEngine
from .trading.service import TradingService
from .trading.store import TradingStore
from .trading.trade_agent import TradeAgent

settings = get_settings()

# 启动即打印实际生效的 Claude 配置（key 脱敏）——一眼看出请求会发到哪个 endpoint，
# 避免再被 shell 残留的 ANTHROPIC_* 环境变量悄悄劫持还查不出来。
_k = settings.anthropic_api_key
print(
    f"[fanisl] Claude endpoint={settings.anthropic_base_url or 'https://api.anthropic.com(官方默认)'}"
    f" | model={settings.model}"
    f" | key={(_k[:8] + '…(len%d)' % len(_k)) if _k else '(空)'}",
    flush=True,
)

# 鉴权状态也一并打出来。开发时最容易发生的困惑是"我明明改了 .env 怎么还要登录"
# 或者反过来"这台机器上怎么不用登录"——让它在启动第一行就说清楚，省掉一轮排查。
print(
    f"[fanisl] auth={'ON' if settings.auth_enabled else 'OFF（全站免登录！仅限本机开发）'}"
    f" | cookie_secure={settings.auth_cookie_secure}",
    flush=True,
)

# 连的是哪个库——横幅上原先唯独缺这一项，而它是后果最重的一项。
#
# 开发机上 `PG_CONNINFO` 常常指着 `port=5433`，那是通到生产的 SSH 隧道（隧道是有意的，
# 提取/归并那条流程就靠它）。但**跑本地服务时连着它，等于拿生产库做开发**：
# 页面上会显示生产缓存下来的真实数字，而任何写入都直接落在生产上。
# 这件事从界面上完全看不出来，只能在启动第一屏说。
_dbs = [("行情/对话/用户", settings.pg_conninfo),
        ("交易", settings.pg_trading_conninfo),
        ("知识", settings.pg_knowledge_conninfo)]
_described = [(label, *describe_conninfo(conninfo)) for label, conninfo in _dbs]
_remote = [label for label, _, local in _described if not local]
print("[fanisl] 库 " + " | ".join(f"{label}={where}" for label, where, _ in _described),
      flush=True)
if _remote and not os.getenv("FANISL_ALLOW_REMOTE_DB"):
    # **拒绝启动，不是警告。** 上一版只打一行 ⚠——而警告会随启动日志滚过去，
    # 照样把服务跑在生产库上（2026-09-03 就这么发生了一次）。可以被忽略的警告
    # 就一定会被忽略；这条线要么拦住，要么不如不写。
    #
    # 生产服务器自己不受影响：那边的 conninfo 是 `host=127.0.0.1 dbname=fanisl`，
    # 没有 port、走默认 5432，判定为本机。只有开发机上指着 5433 隧道时才会拦。
    #
    # 确实要用本地服务读生产（复现线上问题），加 FANISL_ALLOW_REMOTE_DB=1。
    raise SystemExit(
        f"[fanisl] 拒绝启动：{'、'.join(_remote)} 指向远端"
        f"（多半是 5433 那条通到生产的隧道）。\n"
        f"  · 本地开发：tools/dev_db.sh 建库，然后\n"
        f"      FANISL_ENV_FILE=.env.dev PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app --port 8000\n"
        f"  · 确实要读生产：FANISL_ALLOW_REMOTE_DB=1 再启动\n"
        f"  详见 backend/README.md「本地开发用隔离的库」")
if _remote:
    print("[fanisl] ⚠ 正在使用**远端**库（FANISL_ALLOW_REMOTE_DB 已设）。写操作会落在生产上。",
          flush=True)

# --- 行情库（行情时间序列 + 对话）---
pool = make_pool(settings.pg_conninfo)
storage = Storage(pool)
# 用户/会话与对话表同库同池：都是"这套工具自身的状态"，与行情、交易、知识三条业务线无关
user_store = UserStore(pool)
# --- 资产台（Binance 只读，全员共用同一个账户）---
# 凭据缺失不是错误路径：客户端照常构造，调用时抛 CredentialsMissing → 每个来源记成
# unauthorized，前端显示"凭据没有通过校验"那一屏。启动阶段不该因为没配 key 就崩。
binance_client = BinanceClient(
    settings.binance_api_key, settings.binance_api_secret,
    private_key_path=settings.binance_private_key_path,
    private_key_passphrase=settings.binance_private_key_passphrase,
    recv_window_ms=settings.binance_recv_window_ms,
    timeout_s=settings.binance_timeout_s,
)
# 凭据状态也在启动第一屏说清楚。配错了不会让服务起不来（那是设计），
# 但必须在日志里看得见，否则表现出来只是"资产页所有来源都 unauthorized"，
# 排查方向会跑偏到 key 权限上去。
print(f"[fanisl] binance key={binance_client.credential_status}", flush=True)
binance_cache = SourceCache(pool)

market_store = MarketStore(
    pool,
    retention_days=settings.retention_days,
    compress_after_days=settings.compress_after_days,
    runs_keep=settings.runs_keep,
)
resolver = build_resolver(settings)
sentiment = build_crypto_sentiment(settings)
catalysts = build_catalysts(settings)
agent = Agent(settings, resolver, sentiment, catalysts, market_store)

# --- 交易评测台（独立库）---
trading_pool = make_pool(settings.pg_trading_conninfo)
trading_store = TradingStore(trading_pool)

# --- 知识引擎（独立库）---
from .knowledge.nodes import NodeStore  # noqa: E402 — 依赖 settings 先就绪
from .knowledge.store import KnowledgeStore  # noqa: E402

knowledge_pool = make_pool(settings.pg_knowledge_conninfo)
knowledge_store = KnowledgeStore(knowledge_pool)
node_store = NodeStore(knowledge_pool)


def live_price(symbol: str) -> float:
    """执行/盯市价以执行源(统一 Binance 永续)为准；TradFi 分析走 Polygon/OANDA，
    但下单与止损止盈按 Binance 成交价计。"""
    r = resolver.resolve(symbol)
    return float(r.exec_source.fetch_ticker(r.exec_symbol)["last"])


trade_engine = TradingEngine(
    trading_store, price_fn=live_price,
    taker_fee_bps=settings.trading_taker_fee_bps, slippage_bps=settings.trading_slippage_bps,
    min_rr=settings.trading_min_rr, reeval_band_pct=settings.trading_reeval_band_pct,
    time_stop_hours=settings.trading_time_stop_hours,
    entry_ttl_hours=settings.trading_entry_ttl_hours,
    reeval_cooldown_min=settings.trading_reeval_cooldown_min,
    reeval_grace_min=settings.trading_reeval_grace_min,
)
trade_agent = TradeAgent(settings, resolver, sentiment, catalysts, market_store)
trading_service = TradingService(
    trading_store, trade_engine, trade_agent, settings=settings,
    market_pool=pool,  # setup 探测器读行情库的时点序列
)


def _build_accounts() -> list[dict]:
    """按 config.trading_accounts 建好全部评测账户（幂等），返回带 spec + id 的行列表。"""
    out: list[dict] = []
    for spec in settings.trading_accounts:
        acct = trading_store.ensure_account(
            spec.name, initial_balance=settings.trading_initial_balance,
            max_leverage=settings.trading_max_leverage, margin_mode=settings.trading_margin_mode,
            default_risk_pct=settings.trading_default_risk_pct,
        )
        # 强制交易标志由 spec 固定（A/B 对照），每次启动对齐
        trading_store.set_force_trade(acct["id"], spec.force)
        out.append({**acct, "spec": spec, "id": int(acct["id"]),
                    "managed": spec.managed, "mirror_of": spec.mirror_of})
    return out


ACCOUNTS = _build_accounts()
ACCOUNT_IDS = {a["spec"].name: a["id"] for a in ACCOUNTS}
# 默认账户（向后兼容：无 account 参数的旧接口/单账户调用都指向 main）
ACCOUNT_ID = ACCOUNT_IDS.get("main", ACCOUNTS[0]["id"])


# --- 进程退出时干净地关连接池 ---------------------------------------------
# 连接池在 import 时就开了（模块级单例），任何 import 本模块的进程（api / api 的 --reload
# 父进程 / collector / trader）都各持一份。若不显式 close，psycopg_pool 会在 __del__ 时
# 对非守护工作线程做 5s join，join 不掉就告警、并拖慢进程退出——表现为「Ctrl+C 停不下来、要 kill」。
# atexit 在每个进程的解释器退出时跑一次，保证各自的池都被关掉。
_pools_closed = threading.Event()


def shutdown_pools() -> None:
    if _pools_closed.is_set():
        return
    _pools_closed.set()
    for p in (pool, trading_pool, knowledge_pool):
        try:
            p.close()
        except Exception:  # noqa: BLE001 — 关池失败不应阻塞退出
            pass


atexit.register(shutdown_pools)
