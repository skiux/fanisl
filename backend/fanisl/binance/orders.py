"""组装 `/orders`，形状对齐 console 契约的 OrdersSnapshot。

这一页的结构被接口的一条硬边界决定：

    **当前挂单能一次拿全账户**   openOrders 的 symbol 可省（现货 weight 80、合约 40）
    **历史只能按交易对逐个问**   allOrders / myTrades 的 symbol 必填，
                                 现货单次区间 ≤ 24 小时，合约 < 7 天、回溯 90 天

所以「挂单」是完整的，「历史」必须先选交易对，并且把窗口上限如实报给前端——
那不是脚注，是这一页能给出什么的边界。

一个读错就会全错的细节：**合约要读 `origType` 而不是 `type`**。条件单触发之后
`type` 会变成 MARKET，只看它的话，一张止盈市价单在成交那一刻会变成"市价单"，
下单时的意图就丢了。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from .cache import SourceCache, SourceResult, fetch_all
from .client import BinanceClient
from .common import dec, dec0, guard, ms_to_iso, price_map, usd_price, usd_value

MS_HOUR = 3_600_000

# 各 venue 的历史窗口，来自官方文档（2026-08 复核）
WINDOW = {
    "spot":   {"max_hours": 24,      "lookback_days": None},
    "usdm":   {"max_hours": 7 * 24,  "lookback_days": 90},
    "margin": {"max_hours": 24,      "lookback_days": None},
}

TTL = {"open": 30, "lists": 60, "algo": 300, "history": 300, "prices": 30, "risk": 30}

# 现货：STOP_LOSS 是止损**市价**，STOP_LOSS_LIMIT 才是止损限价。这两个名字很容易读反。
_SPOT_KIND = {
    "LIMIT": "limit", "MARKET": "market", "LIMIT_MAKER": "limit_maker",
    "STOP_LOSS": "stop_market", "STOP_LOSS_LIMIT": "stop",
    "TAKE_PROFIT": "take_profit_market", "TAKE_PROFIT_LIMIT": "take_profit",
}
_FUT_KIND = {
    "LIMIT": "limit", "MARKET": "market",
    "STOP": "stop", "STOP_MARKET": "stop_market",
    "TAKE_PROFIT": "take_profit", "TAKE_PROFIT_MARKET": "take_profit_market",
    "TRAILING_STOP_MARKET": "trailing_stop_market",
}
_STATUS = {
    "NEW": "new", "PARTIALLY_FILLED": "partially_filled", "FILLED": "filled",
    "CANCELED": "canceled", "PENDING_CANCEL": "canceled",
    "EXPIRED": "expired", "EXPIRED_IN_MATCH": "expired", "REJECTED": "rejected",
}
_SIDE = {"BUY": "buy", "SELL": "sell"}
_POSITION_SIDE = {"BOTH": "both", "LONG": "long", "SHORT": "short"}


def _order(row: dict, venue: str, reference: float | None) -> dict:
    """一条挂单/历史单 → 契约里的 Order。"""
    is_futures = venue == "usdm"
    raw_kind = row.get("origType") or row.get("type", "")
    kind = (_FUT_KIND if is_futures else _SPOT_KIND).get(raw_kind, "limit")

    price = dec(row.get("price"))
    if price is not None and price <= 0:
        price = None                       # 市价单的 price 是 "0"，不是"价格为零"
    stop = dec(row.get("stopPrice"))
    if stop is not None and stop <= 0:
        stop = None
    activate = dec(row.get("activatePrice"))
    if activate is not None and activate <= 0:
        activate = None

    orig = dec0(row.get("origQty"))
    executed = dec0(row.get("executedQty"))
    level = price or stop or activate or reference
    remaining = max(orig - executed, 0.0)

    list_id = row.get("orderListId")
    return {
        "id": f"{venue}:{row.get('orderId')}",
        "venue": venue,
        "symbol": row.get("symbol", ""),
        "side": _SIDE.get(row.get("side", ""), "buy"),
        "kind": kind,
        "status": _STATUS.get(row.get("status", ""), "new"),
        "price": price,
        "stop_price": stop,
        # workingType 只有合约有；现货的条件单一律按最新成交价触发
        "trigger_by": ({"MARK_PRICE": "mark", "CONTRACT_PRICE": "last"}
                       .get(row.get("workingType", ""))
                       if is_futures else ("last" if stop is not None else None)),
        "callback_rate": (dec(row.get("priceRate")) if row.get("priceRate") else None),
        "activate_price": activate,
        "orig_qty": orig,
        "executed_qty": executed,
        # 名义按**未成交部分**算：已经成交的那部分不再占用任何东西
        "notional_usd": None if level is None else remaining * level,
        "time_in_force": row.get("timeInForce") or None,
        "good_till_date": ms_to_iso(row.get("goodTillDate"))
                          if row.get("goodTillDate") else None,
        "reduce_only": bool(row.get("reduceOnly", False)),
        "close_position": bool(row.get("closePosition", False)),
        "position_side": _POSITION_SIDE.get(row.get("positionSide", "")) if is_futures else None,
        # 现货用 -1 表示"不属于任何 OCO 组"，照搬会变成一个假的组号
        "order_list_id": (str(list_id) if list_id not in (None, -1, "-1") else None),
        "reference_price": reference,
        "created_at": ms_to_iso(row.get("time") or row.get("transactTime")),
        "updated_at": ms_to_iso(row.get("updateTime") or row.get("time")),
    }


def _algo_orders(payload: Any, reference_of: Callable[[str], float | None]) -> list[dict]:
    """策略单（TWAP/VP）。字段与普通挂单完全不同，单独映射。"""
    rows = (payload or {}).get("orders", []) if isinstance(payload, dict) else []
    out = []
    for row in rows:
        symbol = row.get("symbol", "")
        reference = reference_of(symbol)
        orig = dec0(row.get("totalQty"))
        executed = dec0(row.get("executedQty"))
        out.append({
            "id": f"usdm:algo-{row.get('algoId')}",
            "venue": "usdm", "symbol": symbol,
            "side": _SIDE.get(row.get("side", ""), "buy"),
            "kind": "twap" if row.get("algoType") == "TWAP" else "vp",
            "status": "new" if row.get("algoStatus") == "WORKING" else "canceled",
            "price": dec(row.get("avgPrice")) or None,
            "stop_price": None, "trigger_by": None, "callback_rate": None,
            "activate_price": None,
            "orig_qty": orig, "executed_qty": executed,
            "notional_usd": None if reference is None else max(orig - executed, 0.0) * reference,
            "time_in_force": None, "good_till_date": ms_to_iso(row.get("endTime")),
            "reduce_only": bool(row.get("reduceOnly", False)), "close_position": False,
            "position_side": _POSITION_SIDE.get(row.get("positionSide", "")),
            "order_list_id": None, "reference_price": reference,
            "created_at": ms_to_iso(row.get("bookTime")),
            "updated_at": ms_to_iso(row.get("bookTime")),
        })
    return out


def _order_lists(payload: Any) -> list[dict]:
    out = []
    for row in payload or []:
        members = row.get("orders") or []
        out.append({
            "id": str(row.get("orderListId")),
            "venue": "spot",
            "symbol": row.get("symbol", ""),
            "contingency": row.get("contingencyType", "OCO"),
            "status": {"EXECUTING": "executing", "ALL_DONE": "all_done",
                       "REJECT": "reject"}.get(row.get("listOrderStatus", ""), "executing"),
            "order_ids": [f"spot:{m.get('orderId')}" for m in members],
            "created_at": ms_to_iso(row.get("transactionTime")),
        })
    return out


def _fill(row: dict, venue: str, prices: dict[str, float]) -> dict:
    """一笔成交。

    **手续费要连着 USD 一起给。** `commission` 的单位是 `commissionAsset`，
    现货常用 BNB 抵扣、合约结在 USDT，两者不是同一个单位。界面上要把一段区间的
    手续费加起来（合并多个交易对之后必然跨币种），不换算就等于把 0.0017 个 BNB
    当成 0.0017 美元——手续费会凭空少掉几百倍。这与 `_income` 那里是同一个坑。
    换不出价就留 `None`，不拿 0 顶。
    """
    qty = dec0(row.get("qty"))
    price = dec0(row.get("price"))
    fee = dec0(row.get("commission"))
    fee_asset = row.get("commissionAsset", "")
    return {
        "id": f"{venue}:t{row.get('id')}",
        "order_id": f"{venue}:{row.get('orderId')}",
        "venue": venue,
        "symbol": row.get("symbol", ""),
        # 现货用 isBuyer 布尔，合约直接给 side——两个接口在这里不一样
        "side": _SIDE.get(row.get("side", ""), "buy" if row.get("isBuyer") else "sell"),
        "price": price,
        "qty": qty,
        "quote_qty": dec0(row.get("quoteQty")) or qty * price,
        "commission": fee,
        "commission_asset": fee_asset,
        "commission_usd": usd_value(fee_asset, fee, prices) if fee_asset else None,
        "is_maker": bool(row.get("maker", row.get("isMaker", False))),
        # 现货成交不结算盈亏，字段本身就没有
        "realized_pnl": dec(row.get("realizedPnl")) if "realizedPnl" in row else None,
        "time": ms_to_iso(row.get("time")),
    }


def _history_symbols(open_orders: list[dict], positions: Any, spot: Any,
                     prices: dict[str, float]) -> list[str]:
    """能查历史的交易对候选。

    allOrders 必须传 symbol，而 Binance 没有"我交易过哪些对"的接口。只能从
    **有挂单 + 有持仓 + 现货余额能配出的交易对**推一份候选——做不到真正的全量，
    这一点在界面上也要说明白。
    """
    out = {o["symbol"] for o in open_orders if o["symbol"]}
    for row in positions or []:
        if dec0(row.get("positionAmt")) != 0:
            out.add(row.get("symbol", ""))
    for row in spot or []:
        asset = row.get("asset", "")
        if asset and dec0(row.get("free")) + dec0(row.get("locked")) > 0:
            pair = f"{asset}USDT"
            if pair in prices:
                out.add(pair)
    return sorted(s for s in out if s)


def _venue_of(symbol: str, futures_symbols: set[str]) -> str:
    return "usdm" if symbol in futures_symbols else "spot"


def build_orders(client: BinanceClient, cache: SourceCache, *,
                 symbol: str | None = None, venue: str | None = None,
                 force: bool = False, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)

    # prices / spot / futures.risk 与 /portfolio 共用同一批缓存键——已经取过就是免费的
    base_jobs: list[tuple[str, int, Callable[[], Any]]] = [
        ("prices", TTL["prices"], client.spot_prices),
        ("spot", 60, client.user_asset),
        ("futures.risk", TTL["risk"], client.futures_position_risk),
        ("orders.spot_open", TTL["open"], client.spot_open_orders),
        ("orders.futures_open", TTL["open"], client.futures_open_orders),
        ("orders.margin_open", TTL["open"], client.margin_open_orders),
        ("orders.lists", TTL["lists"], client.spot_open_order_lists),
        ("orders.algo", TTL["algo"], client.algo_open_orders),
    ]
    results = fetch_all(cache, base_jobs, force=force)

    def payload(key: str) -> Any:
        got = results.get(key)
        return got.payload if got else None

    prices = price_map(payload("prices"))
    risk = payload("futures.risk") or []
    # 条件单按标记价触发，"距触发"就该拿标记价比；取不到再退回最新成交价
    marks = {r.get("symbol"): dec(r.get("markPrice")) for r in risk}

    def reference_of(sym: str, is_futures: bool) -> float | None:
        if is_futures and marks.get(sym) is not None:
            return marks[sym]
        return prices.get(sym) or usd_price(sym, prices)

    # 每组单独装配：一组形状变了只带走那一组，不让整页 500（同 portfolio 的理由）
    errors: dict[str, str] = {}

    def parse(key: str, fn, fallback=None):
        value, error = guard(key, fn, fallback=fallback)
        if error:
            errors[key] = error
        return value

    open_orders: list[dict] = []
    for key, venue_name, state_key in (("orders.spot_open", "spot", "spot_open"),
                                       ("orders.futures_open", "usdm", "futures_open"),
                                       ("orders.margin_open", "margin", "margin_open")):
        rows = parse(state_key, lambda k=key, v=venue_name: [
            _order(row, v, reference_of(row.get("symbol", ""), v == "usdm"))
            for row in payload(k) or []], fallback=[]) or []
        open_orders.extend(rows)
    open_orders.extend(parse("algo_open", lambda: _algo_orders(
        payload("orders.algo"), lambda sym: reference_of(sym, True)), fallback=[]) or [])
    open_orders.sort(key=lambda o: o["created_at"] or "", reverse=True)

    futures_symbols = {r.get("symbol") for r in risk}
    futures_symbols |= {o["symbol"] for o in open_orders if o["venue"] == "usdm"}
    symbols = _history_symbols(open_orders, risk, payload("spot"), prices)

    # --- 历史：接口必须按交易对问，但那不该变成"页面替你挑了一个" -----------
    #
    # 上一版是 `picked = symbol or symbols[0]`：谁都没选的时候，页面按字母序挑了
    # 第一个交易对，于是「委托历史」这一节永远在讲某一个标的，而标题写着的是
    # "委托历史"。**不选就是全部**：把候选里的每一个都问一遍再合并。
    # `allOrders` / `myTrades` 的 symbol 必填是接口的限制，不是产品的形状。
    #
    # 代价是一次要发 2N 个请求（N = 候选交易对数）。可以接受的理由：候选本身由
    # 持仓与余额界定（不是全市场），每个都按 `TTL["history"]` 缓存，
    # 而现货成交那一半 `/portfolio` 本来就在按同样的粒度取。
    targets = [symbol] if symbol else list(symbols)
    venues = {s: (venue if (symbol and venue) else _venue_of(s, futures_symbols))
              for s in targets}
    query = None
    history: list[dict] = []
    fills: list[dict] = []
    history_states: list[dict] = []

    if targets:
        end_ms = int(now.timestamp() * 1000)
        # 按 id 翻页而不是按时间窗。时间窗最多 24 小时（现货）/ 7 天（合约），
        # 只取最近一个窗口的话，上次交易在窗口之前就是一片空白——这就是
        # "历史那里完全没有数据"。合约那边接口本身只留 90 天，走到头自然停。
        jobs: list[tuple[str, int, Callable[[], Any]]] = []
        for sym in targets:
            v = venues[sym]
            # 默认参数绑定：闭包里直接用 `sym` 的话，循环结束后每个 lambda
            # 拿到的都是最后一个交易对
            jobs.append((f"orders.history:{v}:{sym}", TTL["history"],
                         lambda s=sym, vv=v: client.orders_since(s, venue=vv)))
            jobs.append((f"orders.trades:{v}:{sym}", TTL["history"],
                         (lambda s=sym: client.futures_trades_since(s)) if v == "usdm"
                         else (lambda s=sym: client.spot_trades_since(s))))
        hist = fetch_all(cache, jobs, force=force)

        def _orders() -> list[dict]:
            out: list[dict] = []
            for sym in targets:
                v = venues[sym]
                ref = reference_of(sym, v == "usdm")
                got = hist[f"orders.history:{v}:{sym}"]
                out.extend(_order(r, v, ref) for r in (got.payload or []))
            return sorted(out, key=lambda o: o["created_at"] or "", reverse=True)

        def _fills() -> list[dict]:
            out: list[dict] = []
            for sym in targets:
                v = venues[sym]
                got = hist[f"orders.trades:{v}:{sym}"]
                out.extend(_fill(r, v, prices) for r in (got.payload or []))
            return sorted(out, key=lambda f: f["time"] or "", reverse=True)

        history = parse("order_history", _orders, fallback=[]) or []
        fills = parse("trade_history", _fills, fallback=[]) or []

        limits = [WINDOW.get(venues[s], WINDOW["spot"]) for s in targets]
        # 多个交易对合在一起时，能保证的只有**交集**：窗口取最紧的那一个，
        # 报成最宽的那个等于替另一半打了包票
        looks = [x["lookback_days"] for x in limits if x["lookback_days"] is not None]
        lookback = min(looks) if looks else None
        start_ms = end_ms - (lookback or 90) * MS_HOUR * 24
        query = {
            # 没指定交易对时是 None，不是"碰巧第一个"——界面据此写「全部」
            "symbol": symbol or None,
            "symbols": targets,
            "venue": venues[symbol] if symbol else None,
            "from": datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).isoformat(),
            "to": now.isoformat(),
            "max_window_hours": min(x["max_hours"] for x in limits),
            "lookback_days": lookback,
        }
        history_states = [
            {"key": "order_history",
             **_merge_states([hist[f"orders.history:{venues[s]}:{s}"] for s in targets])},
            {"key": "trade_history",
             **_merge_states([hist[f"orders.trades:{venues[s]}:{s}"] for s in targets])},
        ]
    else:
        history_states = [{"key": "order_history", "status": "ok", "as_of": None,
                           "detail": "没有可查的交易对"},
                          {"key": "trade_history", "status": "ok", "as_of": None,
                           "detail": "没有可查的交易对"}]

    states = [
        {"key": "spot_open", **_state(results["orders.spot_open"])},
        {"key": "futures_open", **_state(results["orders.futures_open"])},
        {"key": "margin_open", **_state(results["orders.margin_open"])},
        {"key": "order_lists", **_state(results["orders.lists"])},
        {"key": "algo_open", **_state(results["orders.algo"])},
        *history_states,
    ]
    # 取到了但装配失败：数据是坏的，不能报 ok
    for state in states:
        if state["status"] == "ok" and state["key"] in errors:
            state["status"] = "unsupported"
            state["detail"] = errors[state["key"]]
    fresh = [datetime.fromisoformat(s["as_of"]) for s in states
             if s["status"] == "ok" and s["as_of"]]

    return {
        "as_of": min(fresh).isoformat() if fresh else None,
        "sources": states,
        "open": open_orders,
        "order_lists": parse("order_lists",
                             lambda: _order_lists(payload("orders.lists")), fallback=[]) or [],
        "history_symbols": symbols,
        "query": query,
        "history": history,
        "fills": fills,
    }


def _merge_states(results: list[SourceResult]) -> dict:
    """一组按交易对分别取的结果，并成契约里的一个来源状态。

    **只要有一个没取到，这一组就不是 ok。** 合并出来的历史少了一截，界面上分不出
    是"那个交易对没有记录"还是"那一次没取到"——报 ok 就等于替它说了前者。
    时刻取最旧的一个：整组的新鲜度由最旧的那份决定（同 `/portfolio` 的页面时刻）。
    """
    bad = next((r for r in results if r.status != "ok"), None)
    stamps = [r.as_of for r in results if r.as_of]
    return {"status": bad.status if bad else "ok",
            "as_of": min(stamps).isoformat() if stamps else None,
            "detail": bad.detail if bad else None}


def _state(result: SourceResult) -> dict:
    return {"status": result.status,
            "as_of": result.as_of.isoformat() if result.as_of else None,
            "detail": result.detail}
