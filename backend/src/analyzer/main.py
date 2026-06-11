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

from . import metrics as metrics_registry
from .agent import final_text
from .marketstore import GLOBAL
from .runtime import (
    ACCOUNT_ID,
    ACCOUNT_IDS,
    ACCOUNTS,
    agent,
    market_store,
    pool,
    resolver,
    settings,
    storage,
    trading_pool,
    trading_service,
    trading_store,
)
from .storage import display_messages

# 注意：API 进程**不起后台调度器**。采集/交易由独立的 collector / trader worker 进程跑
# （见 worker_collector.py / worker_trader.py），所以 API 可以多 worker、独立部署重启。

app = FastAPI(title="fanisl", version="0.1.0")


@app.on_event("shutdown")
def _close_pools() -> None:
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


@app.get("/metrics/catalog")
def metrics_catalog() -> dict:
    """全量 metric 目录（登记表 SSOT）：name/category/unit/scope/label/ts_meaning。给前端枚举展示用。"""
    return {"timeframes": list(metrics_registry.TIMEFRAMES), "metrics": metrics_registry.catalog()}


@app.get("/metrics/available")
def metrics_available(symbol: str) -> dict:
    """某 symbol 实际有数据的 metric 及覆盖（样本数/起止/最新值）。前端据此知道该展示什么、历史多深。"""
    return {"symbol": symbol, "coverage": market_store.metric_coverage(symbol)}


@app.get("/catalysts/stored")
def stored_catalysts(symbol: str | None = None) -> list[dict]:
    return market_store.get_catalysts(symbol)


@app.get("/collection/status")
def collection_status() -> dict:
    return {"enabled": settings.collector_enabled, "runs": market_store.status()}


# --- 交易评测台 -----------------------------------------------------------


def _resolve_account(account: str | None) -> int:
    """account 名 → id（默认 main，向后兼容无参调用）。未知名 → 400。"""
    if not account:
        return ACCOUNT_ID
    if account in ACCOUNT_IDS:
        return ACCOUNT_IDS[account]
    if account.isdigit() and int(account) in ACCOUNT_IDS.values():
        return int(account)
    raise HTTPException(status_code=400, detail=f"未知账户 {account}")


@app.get("/trading/accounts")
def trading_accounts() -> list[dict]:
    """全部评测账户（多账户对照实验：A 自然 / B 强制 / 影子）。前端账户切换用。"""
    out = []
    for a in ACCOUNTS:
        spec = a["spec"]
        out.append({
            "name": spec.name, "id": a["id"],
            "force": spec.force, "managed": spec.managed, "mirror_of": spec.mirror_of,
            "summary": trading_service.account_summary(a["id"]),
            "scorecard": trading_store.scorecard(a["id"]),
        })
    return out


class OpenTradeRequest(BaseModel):
    symbol: str
    account: str | None = None


@app.post("/trading/open")
def trading_open(req: OpenTradeRequest) -> dict:
    """让 Claude 评估并（若值得）开一笔交易。同步调用 Claude，可能耗时较久。"""
    sym = req.symbol.strip()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol 不能为空")
    try:
        return trading_service.open_trade(_resolve_account(req.account), sym)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 错误: {e}") from e


@app.post("/trading/tick")
def trading_tick(account: str | None = None) -> dict:
    """手动推进一拍：撮合/盯市/止损止盈 + 触发的自主管理/复盘。"""
    return trading_service.cycle(_resolve_account(account))


@app.post("/trading/scan")
def trading_scan(account: str | None = None) -> dict:
    """手动触发一次自主扫描（同调度器的 4h 任务）。同步调用 Claude，可能耗时。"""
    try:
        return trading_service.scan(_resolve_account(account))
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 错误: {e}") from e


@app.get("/trading/positions")
def trading_positions(account: str | None = None) -> list[dict]:
    """持仓实时状态：每笔未平仓交易的最新盯市快照 + 计划止损止盈。"""
    return trading_service.open_positions(_resolve_account(account))


@app.get("/trading/symbols")
def trading_symbols() -> dict:
    """可交易标的（给前端下拉选择，替代键盘输入）。"""
    return {"symbols": trading_service._scan_universe()}


@app.get("/trading/account")
def trading_account(account: str | None = None) -> dict:
    aid = _resolve_account(account)
    return {
        "summary": trading_service.account_summary(aid),
        "scorecard": trading_store.scorecard(aid),
    }


class ForceTradeRequest(BaseModel):
    enabled: bool
    account: str | None = None


@app.patch("/trading/account/force")
def trading_set_force(req: ForceTradeRequest) -> dict:
    """强制交易开关：开启后 Claude 进场决策不允许"不交易"。"""
    aid = _resolve_account(req.account)
    trading_store.set_force_trade(aid, req.enabled)
    return {"force_trade": req.enabled}


@app.get("/trading/trades")
def trading_trades(account: str | None = None) -> list[dict]:
    return trading_store.list_trades(_resolve_account(account))


@app.get("/trading/trades/{trade_id}")
def trading_trade(trade_id: int) -> dict:
    tl = trading_store.timeline(trade_id)
    if tl["trade"] is None:
        raise HTTPException(status_code=404, detail="交易不存在")
    return tl


@app.post("/trading/trades/{trade_id}/cancel")
def trading_cancel(trade_id: int) -> dict:
    """撤销挂着的限价进场单（仅 planned 状态可撤）。"""
    tr = trading_store.get_trade(trade_id)
    if tr is None:
        raise HTTPException(status_code=404, detail="交易不存在")
    if tr["status"] != "planned":
        raise HTTPException(status_code=409, detail=f"交易状态为 {tr['status']}，不可撤单")
    ok = trading_store.cancel_pending_entry(trade_id, reason="用户手动撤单")
    return {"cancelled": ok, "trade_id": trade_id}


@app.get("/trading/declines")
def trading_declines(account: str | None = None) -> list[dict]:
    return trading_store.list_declines(_resolve_account(account))


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
