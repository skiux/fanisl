"""组装 `/orders`，形状对齐 console 契约的 OrdersSnapshot。

这一页的结构被接口的一条硬边界决定：

    **当前挂单能一次拿全账户**   openOrders 的 symbol 可省（现货 weight 80、合约 40）
    **历史要按交易对问**         现货 allOrders / myTrades 与合约 userTrades 要 symbol；
                                 股票委托与成交不要 symbol，一次拿全账户

所以「挂单」是完整的，「历史」是把候选交易对逐个问完再合并，并且把窗口上限如实
报给前端——那不是脚注，是这一页能给出什么的边界。

合约 allOrders 的 symbol 自 2026-08-25（官方 SDK 17.2.1）起可省，这里**不用**那个
全账户查询：2026-09-17 线上「全部」里合约委托一条都没有，而逐个交易对查都在。
那次请求是报错还是返回空没有留下记录，原因未查明，逐个问是已经验证过的那条路。

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
    # 股票接口要求起止时间，但当前文档没有声明最大窗口或历史保留上限。
    "equity": {"max_hours": 90 * 24, "lookback_days": None},
}

TTL = {"open": 30, "lists": 60, "algo": 300, "history": 300, "prices": 30, "risk": 30,
       "income": 300}

# 候选交易对从合约收支里找、股票历史往回取，都是 90 天：income 接口只留 90 天
LOOKBACK_DAYS = 90

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
        "quote_asset": None,
        "trading_session": None,
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
            "quote_asset": None, "trading_session": None,
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


def _conditional_orders(payload: Any,
                        reference_of: Callable[[str], float | None]) -> list[dict]:
    """2025-12 后由 USD-M Algo Service 承载的 TP/SL/追踪止损。"""
    out = []
    for row in payload or []:
        symbol = row.get("symbol", "")
        reference = reference_of(symbol)
        price = dec(row.get("price"))
        if price is not None and price <= 0:
            price = None
        trigger = dec(row.get("triggerPrice"))
        if trigger is not None and trigger <= 0:
            trigger = None
        activate = dec(row.get("activatePrice"))
        if activate is not None and activate <= 0:
            activate = None
        qty = dec0(row.get("quantity"))
        level = price or trigger or activate or reference
        callback = dec(row.get("callbackRate") or row.get("priceRate"))
        if callback is not None:
            callback /= 100
        out.append({
            "id": f"usdm:algo-{row.get('algoId')}",
            "venue": "usdm", "symbol": symbol,
            "quote_asset": None, "trading_session": None,
            "side": _SIDE.get(row.get("side", ""), "buy"),
            "kind": _FUT_KIND.get(row.get("orderType", ""), "limit"),
            "status": "new" if row.get("algoStatus") in ("NEW", "WORKING") else "canceled",
            "price": price, "stop_price": trigger,
            "trigger_by": {"MARK_PRICE": "mark", "CONTRACT_PRICE": "last"}.get(
                row.get("workingType", "")),
            "callback_rate": callback, "activate_price": activate,
            "orig_qty": qty, "executed_qty": 0.0,
            "notional_usd": None if level is None else qty * level,
            "time_in_force": row.get("timeInForce") or None,
            "good_till_date": (ms_to_iso(row.get("goodTillDate"))
                               if dec0(row.get("goodTillDate")) > 0 else None),
            "reduce_only": bool(row.get("reduceOnly", False)),
            "close_position": bool(row.get("closePosition", False)),
            "position_side": _POSITION_SIDE.get(row.get("positionSide", "")),
            "order_list_id": None, "reference_price": reference,
            "created_at": ms_to_iso(row.get("createTime")),
            "updated_at": ms_to_iso(row.get("updateTime") or row.get("createTime")),
        })
    return out


def _equity_order(row: dict, reference: float | None) -> dict:
    """Standalone Stocks Trading 委托；代码是 AAPL，不是 AAPLUSDT。"""
    price = dec(row.get("limitPrice")) or dec(row.get("avgFilledPrice"))
    qty_raw = dec(row.get("qty"))
    executed = dec0(row.get("filledQty"))
    orig = qty_raw if qty_raw is not None else executed
    requested_notional = dec(row.get("notional"))
    filled_total = dec0(row.get("filledTotal"))
    if requested_notional is not None:
        remaining_notional = max(requested_notional - filled_total, 0.0)
    else:
        remaining_notional = None if price is None else max(orig - executed, 0.0) * price
    session = {"RTH": "rth", "EXTENDED": "extended", "24H": "24h"}.get(
        row.get("session", ""))
    return {
        "id": f"equity:{row.get('orderId')}", "venue": "equity",
        "symbol": row.get("symbol", ""), "quote_asset": row.get("quote") or None,
        "trading_session": session,
        "side": _SIDE.get(row.get("side", ""), "buy"),
        "kind": _SPOT_KIND.get(row.get("orderType", ""), "limit"),
        "status": _STATUS.get(row.get("status", ""),
                              "new" if row.get("status") == "ACCEPTED" else "new"),
        "price": price, "stop_price": None, "trigger_by": None,
        "callback_rate": None, "activate_price": None,
        "orig_qty": orig, "executed_qty": executed, "notional_usd": remaining_notional,
        "time_in_force": None, "good_till_date": None,
        "reduce_only": False, "close_position": False, "position_side": None,
        "order_list_id": None, "reference_price": reference,
        "created_at": ms_to_iso(row.get("createdAt")),
        "updated_at": ms_to_iso(row.get("updatedAt") or row.get("createdAt")),
    }


def _equity_fill(row: dict) -> dict:
    qty = dec0(row.get("qty"))
    execution_price = dec0(row.get("price"))
    return {
        "id": f"equity:t{row.get('executionId')}",
        "order_id": f"equity:{row.get('orderId')}",
        "venue": "equity", "symbol": row.get("symbol", ""),
        "side": _SIDE.get(row.get("side", ""), "buy"),
        "price": execution_price, "qty": qty,
        "quote_qty": dec0(row.get("total")) or qty * execution_price,
        # 股票成交历史没有逐笔手续费和 maker 字段；空值比伪造 0/false 更准确。
        "commission": None, "commission_asset": row.get("quote") or "",
        "commission_usd": None, "is_maker": None, "realized_pnl": None,
        "time": ms_to_iso(row.get("executionAt")),
    }


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


def _history_candidates(open_orders: list[dict], positions: Any, income: Any,
                        equity_rows: list[dict], spot: Any,
                        prices: dict[str, float]) -> dict[str, str]:
    """能查历史的交易对 → 它在哪个 venue。

    现货 allOrders / myTrades 与合约 userTrades 必须按交易对问，而 Binance 没有
    "我交易过哪些对"的接口，只能从手里的线索推：挂单、持仓、**合约收支**、
    **股票委托**、现货余额。做不到真正的全量，这一点在界面上也要说明白。

    合约收支与股票委托是 2026-09-17 加的：
    - 合约的每笔成交都有 COMMISSION、持仓期间有 FUNDING_FEE，平掉的仓位能从 90 天
      income 里找回来。原先只看当前持仓，平仓之后它的历史就不在「全部」里了。
    - 股票委托历史不带 symbol 一次拿全。原先股票代码只在碰巧出现在本次结果里时
      才进下拉框，选了别的交易对，SOXL 就从候选里消失了。

    同一个代码出现在几处时，先登记的那处说了算：挂单与持仓在前，现货余额在最后
    （BNBUSDT 既有合约仓位又有现货余额时算合约，与原先一致）。杠杆挂单仍按现货查——
    历史走的是现货端点，这里不假装能分开。
    """
    out: dict[str, str] = {}

    def add(symbol: str, venue: str) -> None:
        if symbol and symbol not in out:
            out[symbol] = venue

    for order in open_orders:
        add(order["symbol"], order["venue"] if order["venue"] in ("usdm", "equity") else "spot")
    for row in positions or []:
        if dec0(row.get("positionAmt")) != 0:
            add(row.get("symbol", ""), "usdm")
    for row in income or []:
        # 划转与返佣这类行 symbol 是空串，add 会跳过
        if isinstance(row, dict):
            add(row.get("symbol", ""), "usdm")
    for row in equity_rows:
        if isinstance(row, dict):
            add(row.get("symbol", ""), "equity")
    for row in spot or []:
        asset = row.get("asset", "")
        if asset and dec0(row.get("free")) + dec0(row.get("locked")) > 0:
            pair = f"{asset}USDT"
            if pair in prices:
                add(pair, "spot")
    return out


def build_orders(client: BinanceClient, cache: SourceCache, *,
                 symbol: str | None = None, venue: str | None = None,
                 force: bool = False, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    end_ms = int(now.timestamp() * 1000)
    lookback_start_ms = end_ms - LOOKBACK_DAYS * 24 * MS_HOUR

    # prices / spot / futures.risk / income 与 /portfolio 共用同一批缓存键——已经取过就是免费的
    base_jobs: list[tuple[str, int, Callable[[], Any]]] = [
        ("prices", TTL["prices"], client.spot_prices),
        ("spot", 60, client.user_asset),
        ("futures.risk", TTL["risk"], client.futures_position_risk),
        ("income", TTL["income"],
         lambda: client.futures_income(start_ms=lookback_start_ms, end_ms=end_ms)),
        ("orders.spot_open", TTL["open"], client.spot_open_orders),
        ("orders.futures_open", TTL["open"], client.futures_open_orders),
        ("orders.conditional_open", TTL["open"], client.futures_open_algo_orders),
        ("orders.equity_market", TTL["history"], client.equity_exchange_info),
        ("orders.equity_open", TTL["open"], client.equity_open_orders),
        # 股票历史不带 symbol 就是全账户：一次取回，选了哪只股票在本地筛。
        # 原先选中某只股票时带着 symbol 去问，却与「全部」共用这一个缓存键，
        # 5 分钟内两种查询会拿到对方的结果（选 SOXL 看到别的股票，或反过来）。
        ("orders.history:equity", TTL["history"],
         lambda: client.equity_order_history(start_ms=lookback_start_ms, end_ms=end_ms)),
        ("orders.trades:equity", TTL["history"],
         lambda: client.equity_trade_history(start_ms=lookback_start_ms, end_ms=end_ms)),
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
    open_orders.extend(parse("conditional_open", lambda: _conditional_orders(
        payload("orders.conditional_open"), lambda sym: reference_of(sym, True)),
        fallback=[]) or [])
    open_orders.extend(parse("equity_open", lambda: [
        _equity_order(row, dec(row.get("limitPrice")) or dec(row.get("avgFilledPrice")))
        for row in payload("orders.equity_open") or []], fallback=[]) or [])
    open_orders.sort(key=lambda o: o["created_at"] or "", reverse=True)

    futures_symbols = {r.get("symbol") for r in risk}
    market_payload = payload("orders.equity_market")
    equity_symbols = {row.get("symbol") for row in (
        market_payload.get("symbols", []) if isinstance(market_payload, dict) else [])}
    equity_orders_raw = [row for row in payload("orders.history:equity") or []
                         if isinstance(row, dict)]
    equity_fills_raw = [row for row in payload("orders.trades:equity") or []
                        if isinstance(row, dict)]
    candidates = _history_candidates(open_orders, risk, payload("income"),
                                     [*equity_orders_raw, *equity_fills_raw],
                                     payload("spot"), prices)

    def venue_of(sym: str) -> str:
        # 显式指定优先；其次是候选里登记的；都不在时按认得出的代码推断
        if symbol and venue:
            return venue
        if sym in candidates:
            return candidates[sym]
        if sym in futures_symbols:
            return "usdm"
        return "equity" if sym in equity_symbols else "spot"

    # --- 历史：接口必须按交易对问，但那不该变成"页面替你挑了一个" -----------
    #
    # 上一版是 `picked = symbol or symbols[0]`：谁都没选的时候，页面按字母序挑了
    # 第一个交易对，于是「委托历史」这一节永远在讲某一个标的，而标题写着的是
    # "委托历史"。**不选就是全部**：把候选里的每一个都问一遍再合并。
    # `allOrders` / `myTrades` 的 symbol 必填是接口的限制，不是产品的形状。
    #
    # 合约也逐个问，不用省略 symbol 的全账户查询（理由见模块注释）。「全部」与
    # 「选定一个」因此走同一条路、共用同一批缓存键，同一个交易对在两处看到的不会不一样。
    #
    # 代价是一次要发 2N 个请求（N = 候选交易对数）。可以接受的理由：候选本身由
    # 持仓、余额与近 90 天的收支界定（不是全市场），每个都按 `TTL["history"]` 缓存，
    # 而现货成交那一半 `/portfolio` 本来就在按同样的粒度取。
    targets = [symbol] if symbol else sorted(candidates)
    venues = {s: venue_of(s) for s in targets}
    with_equity = not symbol or venues[symbol] == "equity"
    query = None
    history: list[dict] = []
    fills: list[dict] = []
    history_states: list[dict] = []

    if targets:
        # 按 id 翻页而不是按时间窗。时间窗最多 24 小时（现货）/ 7 天（合约），
        # 只取最近一个窗口的话，上次交易在窗口之前就是一片空白——这就是
        # "历史那里完全没有数据"。合约那边接口本身只留 90 天，走到头自然停。
        crypto_targets = [s for s in targets if venues[s] != "equity"]
        jobs: list[tuple[str, int, Callable[[], Any]]] = []
        for sym in crypto_targets:
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
            for sym in crypto_targets:
                v = venues[sym]
                got = hist[f"orders.history:{v}:{sym}"]
                out.extend(_order(r, v, reference_of(sym, v == "usdm"))
                           for r in (got.payload or []))
            if with_equity:
                out.extend(_equity_order(r, dec(r.get("avgFilledPrice"))
                                         or dec(r.get("limitPrice")))
                           for r in equity_orders_raw
                           if not symbol or r.get("symbol") == symbol)
            return sorted(out, key=lambda o: o["created_at"] or "", reverse=True)

        def _fills() -> list[dict]:
            out: list[dict] = []
            for sym in crypto_targets:
                v = venues[sym]
                got = hist[f"orders.trades:{v}:{sym}"]
                out.extend(_fill(r, v, prices) for r in (got.payload or []))
            if with_equity:
                out.extend(_equity_fill(r) for r in equity_fills_raw
                           if not symbol or r.get("symbol") == symbol)
            return sorted(out, key=lambda f: f["time"] or "", reverse=True)

        history = parse("order_history", _orders, fallback=[]) or []
        fills = parse("trade_history", _fills, fallback=[]) or []

        limits = [WINDOW.get(venues[s], WINDOW["spot"]) for s in targets]
        if not symbol and "equity" not in venues.values():
            limits.append(WINDOW["equity"])
        # 多个交易对合在一起时，能保证的只有**交集**：窗口取最紧的那一个，
        # 报成最宽的那个等于替另一半打了包票
        looks = [x["lookback_days"] for x in limits if x["lookback_days"] is not None]
        lookback = min(looks) if looks else None
        start_ms = end_ms - (lookback or LOOKBACK_DAYS) * MS_HOUR * 24
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
        history_results = [hist[f"orders.history:{venues[s]}:{s}"] for s in crypto_targets]
        trade_results = [hist[f"orders.trades:{venues[s]}:{s}"] for s in crypto_targets]
        if with_equity:
            history_results.append(results["orders.history:equity"])
            trade_results.append(results["orders.trades:equity"])
        if not symbol:
            # 「全部」的候选靠合约收支补上已平仓的交易对。收支没取到，合并出来的历史
            # 可能少了那几个交易对，不能报 ok
            history_results.append(results["income"])
            trade_results.append(results["income"])
        history_states = [
            {"key": "order_history", **_merge_states(history_results)},
            {"key": "trade_history", **_merge_states(trade_results)},
        ]
    else:
        history_states = [{"key": "order_history", "status": "ok", "as_of": None,
                           "detail": "没有可查的交易对"},
                          {"key": "trade_history", "status": "ok", "as_of": None,
                           "detail": "没有可查的交易对"}]

    states = [
        {"key": "spot_open", **_state(results["orders.spot_open"])},
        {"key": "futures_open", **_state(results["orders.futures_open"])},
        {"key": "conditional_open", **_state(results["orders.conditional_open"])},
        {"key": "equity_market", **_state(results["orders.equity_market"])},
        {"key": "equity_open", **_state(results["orders.equity_open"])},
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
    history_symbols = sorted(set(candidates) | {o["symbol"] for o in history if o["symbol"]})

    return {
        "as_of": min(fresh).isoformat() if fresh else None,
        "sources": states,
        "open": open_orders,
        "order_lists": parse("order_lists",
                             lambda: _order_lists(payload("orders.lists")), fallback=[]) or [],
        "history_symbols": history_symbols,
        # 下拉框按它分组。股票代码没有计价币后缀，只按计价币分会落进「其他」
        "history_venues": {s: candidates.get(s) or venue_of(s) for s in history_symbols},
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
