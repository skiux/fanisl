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
from contextlib import asynccontextmanager

from .runtime import (
    ACCOUNT_ID,
    ACCOUNT_IDS,
    ACCOUNTS,
    agent,
    market_store,
    resolver,
    settings,
    shutdown_pools,
    storage,
    trading_service,
    knowledge_store,
    knowledge_pool,
    node_store,
    trading_store,
)
from .knowledge import discovery, spotcheck
from .knowledge.browser import browse_nodes_page, browse_units_page, verification_page, verification_summary
from .knowledge.overview import overview_stats
from .storage import display_messages

# 注意：API 进程**不起后台调度器**。采集/交易由独立的 collector / trader worker 进程跑
# （见 worker_collector.py / worker_trader.py），所以 API 可以多 worker、独立部署重启。

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    yield
    shutdown_pools()  # 优雅关闭时关池（atexit 兜底其余进程，见 runtime.shutdown_pools）


app = FastAPI(title="fanisl", version="0.1.0", lifespan=_lifespan)

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
            "setups": spec.setups, "manual": spec.manual,
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


@app.get("/knowledge/creators")
def knowledge_creators() -> list[dict]:
    """信源登记表（含各平台 handle）。"""
    return knowledge_store.creators()


@app.get("/knowledge/overview")
def knowledge_overview() -> dict[str, int]:
    """首页与导航使用的当前知识库规模；不受列表接口 limit 截断。"""
    return overview_stats(knowledge_pool)


@app.get("/knowledge/contents")
def knowledge_contents(status: str | None = None, limit: int = 200) -> list[dict]:
    """L0 内容列表（不含全文；带信源名/字数/单元数/状态）。"""
    return knowledge_store.list_contents(status=status, limit=limit)


@app.get("/knowledge/contents/{content_id}")
def knowledge_content(content_id: int) -> dict:
    """单条内容全文（转录 + 视觉笔记）。"""
    row = knowledge_store.get_content(content_id)
    if row is None:
        raise HTTPException(status_code=404, detail="内容不存在")
    return row


@app.get("/knowledge/contents/{content_id}/units")
def knowledge_content_units(content_id: int) -> list[dict]:
    """某内容提取出的 L1 单元（claim/method/concept，含冻结的评分规格与到期评分）。"""
    return knowledge_store.units_for_content(content_id)


@app.get("/knowledge/tags")
def knowledge_tags() -> list[dict]:
    """标签枢纽：受控词表实际使用计数（按 kind 细分）。"""
    return knowledge_store.tags()


@app.get("/knowledge/units")
def knowledge_units(kind: str | None = None, creator: int | None = None,
                    tag: str | None = None, symbol: str | None = None,
                    q: str | None = None, limit: int = 200) -> list[dict]:
    """跨内容单元浏览：知识库的判断/方法/认知/标签/标的入口 + 全文检索（⌘K）。"""
    return knowledge_store.browse_units(
        kind=kind, creator_id=creator, tag=tag, symbol=symbol, q=q, limit=min(limit, 500))


@app.get("/knowledge/units-page")
def knowledge_units_page(kind: str | None = None, creator: int | None = None,
                         tag: str | None = None, symbol: str | None = None,
                         q: str | None = None, scored: bool = False, limit: int = 100,
                         offset: int = 0) -> dict:
    """跨内容单元分页浏览；返回完整筛选总数，不把当前页长度当作全库规模。"""
    return browse_units_page(
        knowledge_pool,
        kind=kind,
        creator_id=creator,
        tag=tag,
        symbol=symbol,
        q=q,
        scored=scored,
        limit=min(max(limit, 1), 200),
        offset=max(offset, 0),
    )


@app.get("/knowledge/units/{unit_id}")
def knowledge_unit(unit_id: int) -> dict:
    """单元详情：单元 + 信源/内容元信息 + 全部评分行（证据链下钻的落点）。"""
    row = knowledge_store.unit_detail(unit_id)
    if row is None:
        raise HTTPException(status_code=404, detail="单元不存在")
    return row


@app.get("/knowledge/nodes")
def knowledge_nodes(kind: str | None = None, status: str | None = None,
                    tag: str | None = None, cross_source: bool = False,
                    limit: int = 300) -> list[dict]:
    """规范知识节点列表（K5 归并层）：含提及数/跨源数/时间跨度/评分聚合，按提及数排序。
    cross_source=true 只看跨信源共识节点。"""
    return node_store.list_nodes(kind=kind, status=status, tag=tag,
                                 cross_source=cross_source, limit=min(limit, 500))


@app.get("/knowledge/nodes-page")
def knowledge_nodes_page(kind: str | None = None, status: str | None = None,
                         tag: str | None = None, q: str | None = None,
                         limit: int = 200, offset: int = 0) -> dict:
    """长期知识节点分页索引；返回全量总数并保持排序稳定。"""
    return browse_nodes_page(
        knowledge_pool,
        kind=kind,
        status=status,
        tag=tag,
        q=q,
        limit=min(max(limit, 1), 500),
        offset=max(offset, 0),
    )


@app.get("/knowledge/nodes/{node_id}")
def knowledge_node(node_id: int) -> dict:
    """节点详情：canonical + 生命周期状态 + 全部提及（unit 证据链，含逐条评分）+ 关系边。"""
    row = node_store.get_node(node_id)
    if row is None:
        raise HTTPException(status_code=404, detail="节点不存在")
    return row


@app.get("/knowledge/relations")
def knowledge_relations(relation: str | None = None) -> list[dict]:
    """节点关系边（K6 发现层）：conflicts=跨源对立命题，relates=高置信互补。"""
    return node_store.list_relations(relation=relation)


@app.get("/knowledge/harness-candidates")
def knowledge_harness_candidates() -> list[dict]:
    """可回测 Method 节点清单（testability=A）——流向研究 harness 的候选，prereg 仍走人工。"""
    return discovery.harness_candidates(knowledge_pool)


@app.get("/knowledge/weekly")
def knowledge_weekly(days: int = 7) -> dict:
    """周报（现算）：知识增量/新到期评分/关系边/即将到期时点/抽查覆盖，markdown 同步落盘。"""
    return discovery.weekly_report(knowledge_pool, days=min(days, 60))


@app.get("/knowledge/spot-checks")
def knowledge_spot_checks() -> dict:
    """抽查队列统计：覆盖率 + verdict 分布 + 最近记录。"""
    return spotcheck.stats(knowledge_pool)


@app.get("/knowledge/recent-scores")
def knowledge_recent_scores(days: int = 14, limit: int = 100) -> list[dict]:
    """新到期评分流（今日页）：按评分落库时刻倒序。"""
    return knowledge_store.recent_scores(days=min(days, 90), limit=min(limit, 300))


@app.get("/knowledge/verification-queue")
def knowledge_verification_queue(days: int = 14, limit: int = 120) -> dict:
    """验证中心行动队列：即将到期、近期判定、不可判与需复核分开呈现。"""
    return knowledge_store.verification_queue(days=min(days, 90), limit=min(limit, 300))


@app.get("/knowledge/verification-summary")
def knowledge_verification_summary(days: int = 14) -> dict:
    """验证中心未截断总数与最近待执行记录。"""
    return verification_summary(knowledge_pool, days=min(max(days, 1), 90))


@app.get("/knowledge/verification-page")
def knowledge_verification_page(bucket: str = "recent", days: int = 14,
                                limit: int = 100, offset: int = 0) -> dict:
    """验证队列按分类分页；bucket=recent|due|review|unavailable。"""
    if bucket not in {"recent", "due", "review", "unavailable"}:
        raise HTTPException(status_code=400, detail="非法验证分类")
    return verification_page(
        knowledge_pool,
        bucket=bucket,
        days=min(max(days, 1), 90),
        limit=min(max(limit, 1), 200),
        offset=max(offset, 0),
    )


@app.get("/knowledge/verifications/{score_id}")
def knowledge_verification_detail(score_id: int) -> dict:
    """单次机械评分的完整档案：原 Claim、冻结口径、判定结果、出处与节点影响。"""
    row = knowledge_store.verification_detail(score_id)
    if row is None:
        raise HTTPException(status_code=404, detail="验证记录不存在")
    return row


@app.get("/knowledge/prices")
def knowledge_prices(symbol: str, since: str, until: str | None = None) -> dict:
    """daily_bars 日线窗口（claim 证据图用）。symbol 用 claim 的 asset_symbol 口径。"""
    import datetime as _dt

    from .knowledge.prices import SYMBOL_MAP, FRED_SERIES, PriceStore

    start = _dt.date.fromisoformat(since)
    end = _dt.date.fromisoformat(until) if until else _dt.date.today()
    rows = PriceStore(knowledge_store.pool).window(symbol, start, end)
    note = ""
    if symbol in SYMBOL_MAP:
        note = SYMBOL_MAP[symbol][2]
    elif symbol in FRED_SERIES:
        note = FRED_SERIES[symbol]
    return {"symbol": symbol, "note": note, "bars": rows}


# --- 研究档案（doc/ 内白名单文档的只读陈列）-------------------------------

_RESEARCH_DOCS = {
    "capstone": ("research/research-capstone.md", "研究收官：问题 / 方法 / 23 裁决 / 遗产"),
    "research-log": ("research/research-log.md", "逐假设裁决日志（H1–H22）"),
    "eval-repositioning": ("trading-eval-repositioning.md", "评测台重定位：setup 评 edge / 闸门 / 实盘镜像"),
    "knowledge-engine": ("knowledge-engine-design.md", "知识引擎设计：定位 / 分层 / K0–K6"),
}


@app.get("/research/docs")
def research_docs() -> list[dict]:
    """研究档案索引（负结果是资产：capstone 与裁决日志在产品内体面陈列）。"""
    return [{"name": k, "title": t} for k, (_, t) in _RESEARCH_DOCS.items()]


@app.get("/research/docs/{name}")
def research_doc(name: str) -> dict:
    from pathlib import Path

    if name not in _RESEARCH_DOCS:
        raise HTTPException(status_code=404, detail="文档不存在")
    rel, title = _RESEARCH_DOCS[name]
    path = Path(__file__).resolve().parents[3] / "doc" / rel
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"文件缺失：doc/{rel}")
    return {"name": name, "title": title, "path": f"doc/{rel}", "content": path.read_text()}


@app.get("/knowledge/scoreboard")
def knowledge_scoreboard() -> list[dict]:
    """信源联赛表：claim 战绩（hit=1/partial=0.5 计命中率）+ 含糊率 + sign 类 50% 基线二项检验。

    p 值口径：仅 sign 类（方向判断）有天然 50% 随机基线；其余 method 的基线由价格路径决定，
    v1 不给显著性。样本极小时 p 无意义，前端如实展示。

    **二项检验的观测单位是 claim，不是评分行**：一条 claim 的 +7/+30/+90 三个阶梯时点是
    对同一判断的三次相关观测，当成三次独立抛硬币会把 n 灌水、p 值虚低（2026-08-14 质检发现：
    按行算 Andy 17/38=44.7%「劣于随机」，按 claim 算 16/29=55.2%「优于随机」，结论符号都翻了）。
    这里按阶梯多数决把每条 claim 折成一票。

    仍未解决、读数时须自行折价的是基线本身：50% 只对「涨跌各半」成立，而语料里 up 向判断
    占多数、评分窗口又落在一段上行行情里，真实基线高于 50%，故 p 值只可作排序参考。"""
    import math

    rows = knowledge_store.scoreboard()
    with knowledge_store.pool.connection() as conn:
        sign_rows = conn.execute("""
            WITH per_claim AS (
              SELECT u.creator_id, s.unit_id,
                     count(*) FILTER (WHERE s.outcome='hit') * 2 >= count(*) AS hit
              FROM claim_scores s JOIN knowledge_units u ON u.id=s.unit_id
              WHERE u.payload->'scoring_spec'->>'method'='sign'
                AND s.outcome IN ('hit','miss')
              GROUP BY u.creator_id, s.unit_id)
            SELECT creator_id, count(*) FILTER (WHERE hit) AS hits, count(*) AS n
            FROM per_claim GROUP BY creator_id""").fetchall()
    sign_by = {r["creator_id"]: r for r in sign_rows}
    for r in rows:
        scored = r["scored"] or 0
        r["hit_rate"] = round((r["hits"] + 0.5 * r["partials"]) / scored, 3) if scored else None
        r["vague_rate"] = round(r["d_claims"] / r["claims"], 3) if r["claims"] else None
        sg = sign_by.get(r["creator_id"])
        if sg and sg["n"]:
            k, n = sg["hits"], sg["n"]
            # 单侧二项检验 vs 50%：P(X≥k)（优于随机）；k<n/2 时报 P(X≤k)（劣于随机），符号区分
            tail_ge = sum(math.comb(n, i) for i in range(k, n + 1)) / 2 ** n
            tail_le = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
            r["sign_n"], r["sign_hits"] = n, k
            r["sign_p"] = round(min(tail_ge, tail_le), 3)
            r["sign_side"] = "above" if k * 2 >= n else "below"
        else:
            r["sign_n"] = r["sign_hits"] = r["sign_p"] = r["sign_side"] = None
    return rows


@app.get("/trading/setups")
def trading_setups(account: str | None = None) -> dict:
    """Playbook 注册表 + 按 setup 聚合的 edge 评测（live vs 回测先验对照）+ 最近信号。

    评测台重定位后的核心视图：评的是 setup 类型在 N 次里赚不赚，不是单笔判断。
    account 不传 = 跨全部账户聚合。
    """
    from .trading import playbook
    aid = _resolve_account(account) if account else None
    registry = {s.key: s.model_dump() for s in playbook.SETUPS}
    return {
        "registry": registry,
        "scorecard": trading_store.scorecard_by_setup(aid),
        "signals": trading_store.list_setup_signals(aid) if aid else [],
    }


class ManualOpenRequest(BaseModel):
    account: str | None = None
    symbol: str
    side: str
    setup_key: str
    entry_type: str = "market"
    entry_price: float
    sl_price: float
    tp_price: float | None = None
    risk_pct: float = 1.0
    leverage: float = 2.0
    thesis: str | None = None


@app.post("/trading/manual/open")
def trading_manual_open(req: ManualOpenRequest) -> dict:
    """手动镜像实盘进场（Claude 不介入）：录入你实盘的这笔交易，引擎照常撮合与评测。"""
    from .trading.models import ManualPlan
    aid = _resolve_account(req.account or "live")
    mplan = ManualPlan.model_validate(req.model_dump(exclude={"account"}))
    return trading_service.manual_open(aid, mplan)


class ManualCloseRequest(BaseModel):
    reason: str | None = None


@app.post("/trading/manual/{trade_id}/close")
def trading_manual_close(trade_id: int, req: ManualCloseRequest) -> dict:
    """手动镜像实盘平仓：市价全平。"""
    tr = trading_store.get_trade(trade_id)
    if tr is None:
        raise HTTPException(status_code=404, detail="交易不存在")
    return trading_service.manual_close(trade_id, reason=req.reason or "手动平仓（跟随实盘）")


@app.post("/trading/detect")
def trading_detect(account: str | None = None) -> dict:
    """手动触发一轮 setup 探测（同调度器任务）。闸门同步调用 Claude，可能耗时。"""
    aid = _resolve_account(account or "setups")
    try:
        return {"detected": trading_service.detect_setups(aid),
                "vetoes_verified": trading_service.verify_vetoes(aid)}
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API 错误: {e}") from e


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
