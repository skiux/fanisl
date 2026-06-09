"""FastAPI app：POST /chat（非流式 v1）+ 几个查询接口。

每次 /chat：存用户消息 → 载入完整历史 → 跑工具循环 → 持久化新产生的消息 → 返回回复。
"""

from __future__ import annotations

import json

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agent import Agent, final_text
from .collector import collect_catalysts, collect_market
from .config import get_settings
from .data.factory import build_catalysts, build_crypto_sentiment, build_resolver
from .db import make_pool
from .marketstore import GLOBAL, MarketStore
from .scheduler import Scheduler
from .storage import Storage, display_messages
from .trading.engine import TradingEngine
from .trading.service import TradingService
from .trading.store import TradingStore
from .trading.trade_agent import TradeAgent

settings = get_settings()
pool = make_pool(settings.pg_conninfo)
storage = Storage(pool)
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

# --- 交易评测台（独立库）---------------------------------------------------
trading_pool = make_pool(settings.pg_trading_conninfo)
trading_store = TradingStore(trading_pool)


def _live_price(symbol: str) -> float:
    # 执行/盯市价以执行源(统一 Binance 永续)为准；TradFi 分析虽走 Polygon/OANDA，
    # 但下单与止损止盈按 Binance 成交价计。
    r = resolver.resolve(symbol)
    return float(r.exec_source.fetch_ticker(r.exec_symbol)["last"])


trade_engine = TradingEngine(
    trading_store, price_fn=_live_price,
    taker_fee_bps=settings.trading_taker_fee_bps, slippage_bps=settings.trading_slippage_bps,
    min_rr=settings.trading_min_rr, reeval_band_pct=settings.trading_reeval_band_pct,
    time_stop_hours=settings.trading_time_stop_hours,
)
trade_agent = TradeAgent(settings, resolver, sentiment, catalysts, market_store)
trading_service = TradingService(trading_store, trade_engine, trade_agent, settings=settings)
_account = trading_store.ensure_account(
    "main", initial_balance=settings.trading_initial_balance,
    max_leverage=settings.trading_max_leverage, margin_mode=settings.trading_margin_mode,
    default_risk_pct=settings.trading_default_risk_pct,
)
ACCOUNT_ID = int(_account["id"])

_jobs = [
    ("market", settings.collect_market_interval_s,
     lambda: collect_market(resolver, settings, sentiment, market_store)),
    ("catalysts", settings.collect_catalysts_interval_s,
     lambda: collect_catalysts(catalysts, settings, market_store)),
]
if settings.trading_enabled:
    # 快节奏确定性盯市（开仓时才真正干活）+ 慢节奏 Claude 管理/复盘，两个节奏分开
    _jobs.append(("trading_mark", settings.trading_mark_interval_s,
                  lambda: trading_service.mark(ACCOUNT_ID)))
    _jobs.append(("trading_manage", settings.trading_tick_interval_s,
                  lambda: trading_service.manage_and_review(ACCOUNT_ID)))
    if settings.trading_scan_enabled:
        # 自主扫描：每 4h Claude 在全标的里找机会（受仓位/风险上限约束）
        _jobs.append(("trading_scan", settings.trading_scan_interval_s,
                      lambda: trading_service.scan(ACCOUNT_ID)))
_scheduler = Scheduler(_jobs)

app = FastAPI(title="fanisl", version="0.1.0")


@app.on_event("startup")
def _start_collector() -> None:
    if settings.collector_enabled or settings.trading_enabled:
        _scheduler.start()


@app.on_event("shutdown")
def _stop_collector() -> None:
    if settings.collector_enabled:
        _scheduler.stop()
    pool.close()
    trading_pool.close()

# 本地前端开发用：放开 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_DEFAULT_TICKER = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT"


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class ChatRequest(BaseModel):
    message: str
    conversation_id: int | None = None


class ChatResponse(BaseModel):
    conversation_id: int
    reply: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": settings.model, "exchange": settings.exchange}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message 不能为空")

    # conversation_id 省略 / null / 0（Swagger 对 int 默认填 0）都视为开新对话；
    # 合法 id 从 1 开始自增。
    if not req.conversation_id:
        conversation_id = storage.create_conversation(title=req.message[:40])
    else:
        conversation_id = req.conversation_id
        if not storage.conversation_exists(conversation_id):
            raise HTTPException(status_code=404, detail="conversation 不存在")

    storage.add_message(conversation_id, "user", req.message)
    history = storage.get_history(conversation_id)
    prev_len = len(history)

    try:
        history = agent.run_turn(history)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 错误: {e}") from e

    # 持久化本轮新产生的消息（assistant + 工具往返）
    for msg in history[prev_len:]:
        storage.add_message(conversation_id, msg["role"], msg["content"])
    storage.touch_conversation(conversation_id)

    reply = final_text(history[-1]["content"]) if history else ""
    return ChatResponse(conversation_id=conversation_id, reply=reply)


@app.post("/chat/stream")
def chat_stream(req: ChatRequest) -> StreamingResponse:
    """SSE 流式：start → (delta|status)* → done|error。"""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message 不能为空")
    if not req.conversation_id:
        conversation_id = storage.create_conversation(title=req.message[:40])
    else:
        conversation_id = req.conversation_id
        if not storage.conversation_exists(conversation_id):
            raise HTTPException(status_code=404, detail="conversation 不存在")

    storage.add_message(conversation_id, "user", req.message)
    history = storage.get_history(conversation_id)
    prev_len = len(history)

    def gen():
        yield _sse("start", {"conversation_id": conversation_id})
        try:
            for event, data in agent.stream_turn(history):
                yield _sse(event, data if isinstance(data, dict) else {"text": data})
        except anthropic.APIError as e:
            yield _sse("error", {"detail": f"Claude API 错误: {e}"})
            return
        for msg in history[prev_len:]:
            storage.add_message(conversation_id, msg["role"], msg["content"])
        storage.touch_conversation(conversation_id)
        yield _sse("done", {"conversation_id": conversation_id})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/price")
def price(symbols: str = _DEFAULT_TICKER) -> list[dict]:
    """各标的最新价 + 24h 涨跌幅，给前端价格条轮询。按 symbol 路由到对应源。"""
    out = []
    for sym in [s.strip() for s in symbols.split(",") if s.strip()]:
        try:
            r = resolver.resolve(sym)
            t = r.source.fetch_ticker(r.provider_symbol)
            t["symbol"] = r.canonical
            out.append(t)
        except Exception as e:  # noqa: BLE001
            out.append(
                {"symbol": sym, "last": None, "change_pct_24h": None, "error": str(e)[:80]}
            )
    return out


# --- 市场数据（采集的时间序列 / 催化剂 / 采集状态）-------------------------


@app.get("/watchlist")
def watchlist() -> dict:
    """watchlist 概览：每币最新关键指标 + 全市场指标（给前端卡片）。"""
    return {
        "symbols": [
            {"symbol": s, "metrics": market_store.latest_metrics(s)}
            for s in settings.watchlist
        ],
        "global": market_store.latest_metrics(GLOBAL),
    }


@app.get("/metrics")
def metrics(symbol: str, names: str, since: str | None = None) -> dict:
    """多指标时间序列。names 逗号分隔；symbol=GLOBAL 取全市场指标。"""
    wanted = [n.strip() for n in names.split(",") if n.strip()]
    return {"symbol": symbol, "series": market_store.get_series(symbol, wanted, since)}


@app.get("/catalysts/stored")
def stored_catalysts(symbol: str | None = None) -> list[dict]:
    return market_store.get_catalysts(symbol)


@app.get("/collection/status")
def collection_status() -> dict:
    return {"enabled": settings.collector_enabled, "runs": market_store.status()}


# --- 交易评测台 -----------------------------------------------------------


class OpenTradeRequest(BaseModel):
    symbol: str


@app.post("/trading/open")
def trading_open(req: OpenTradeRequest) -> dict:
    """让 Claude 评估并（若值得）开一笔交易。同步调用 Claude，可能耗时较久。"""
    sym = req.symbol.strip()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol 不能为空")
    try:
        return trading_service.open_trade(ACCOUNT_ID, sym)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 错误: {e}") from e


@app.post("/trading/tick")
def trading_tick() -> dict:
    """手动推进一拍：撮合/盯市/止损止盈 + 触发的自主管理/复盘。"""
    return trading_service.cycle(ACCOUNT_ID)


@app.post("/trading/scan")
def trading_scan() -> dict:
    """手动触发一次自主扫描（同调度器的 4h 任务）。同步调用 Claude，可能耗时。"""
    try:
        return trading_service.scan(ACCOUNT_ID)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 错误: {e}") from e


@app.get("/trading/positions")
def trading_positions() -> list[dict]:
    """持仓实时状态：每笔未平仓交易的最新盯市快照 + 计划止损止盈。"""
    return trading_service.open_positions(ACCOUNT_ID)


@app.get("/trading/account")
def trading_account() -> dict:
    return {
        "summary": trading_service.account_summary(ACCOUNT_ID),
        "scorecard": trading_store.scorecard(ACCOUNT_ID),
    }


class ForceTradeRequest(BaseModel):
    enabled: bool


@app.patch("/trading/account/force")
def trading_set_force(req: ForceTradeRequest) -> dict:
    """强制交易开关：开启后 Claude 进场决策不允许"不交易"。"""
    trading_store.set_force_trade(ACCOUNT_ID, req.enabled)
    return {"force_trade": req.enabled}


@app.get("/trading/trades")
def trading_trades() -> list[dict]:
    return trading_store.list_trades(ACCOUNT_ID)


@app.get("/trading/trades/{trade_id}")
def trading_trade(trade_id: int) -> dict:
    tl = trading_store.timeline(trade_id)
    if tl["trade"] is None:
        raise HTTPException(status_code=404, detail="交易不存在")
    return tl


@app.get("/trading/declines")
def trading_declines() -> list[dict]:
    return trading_store.list_declines(ACCOUNT_ID)


@app.get("/conversations")
def list_conversations() -> list[dict]:
    return storage.list_conversations()


@app.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int) -> dict:
    """加载用：标题 + 折叠成对话气泡的消息（user/assistant 文本，去掉工具往返）。"""
    conv = storage.get_conversation(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="conversation 不存在")
    conv["messages"] = display_messages(storage.get_history(conversation_id))
    return conv


class RenameRequest(BaseModel):
    title: str


@app.patch("/conversations/{conversation_id}")
def rename_conversation(conversation_id: int, req: RenameRequest) -> dict:
    if not storage.conversation_exists(conversation_id):
        raise HTTPException(status_code=404, detail="conversation 不存在")
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title 不能为空")
    storage.update_title(conversation_id, title[:80])
    return {"ok": True}


@app.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int) -> dict:
    if not storage.conversation_exists(conversation_id):
        raise HTTPException(status_code=404, detail="conversation 不存在")
    storage.delete_conversation(conversation_id)
    return {"ok": True}


@app.get("/conversations/{conversation_id}/messages")
def get_messages(conversation_id: int) -> list[dict]:
    if not storage.conversation_exists(conversation_id):
        raise HTTPException(status_code=404, detail="conversation 不存在")
    return storage.get_history(conversation_id)
