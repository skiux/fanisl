"""组装 `/portfolio` 的快照，形状对齐 `console/src/api/types.ts` 的 PortfolioSnapshot。

一页数据来自十来个端点，它们**各自会独立地坏**——用户的网络里 451 是间歇的，而且
常常只打在 fapi 上。所以这里每个来源单独取、单独缓存、单独记状态，前端那套
"按来源分组降级"才有东西可依。

三条不肯让步的口径：
- **取不到就是 null，不拿 0 顶替**。0 是一个有效余额。
- **日快照是 BTC 计价的**，换 USD 要用**当天**的 BTC 收盘价；拿今天的价乘 30 天前的
  余额，画出来的是 BTC 的走势不是账户的。
- **归因算不出来就整块留空**。恒等式缺任何一项都不闭合，与其给一张对不上账的表，
  不如明说这一节暂时算不了。
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .cache import SourceCache, SourceResult, fetch_all
from .client import BinanceClient
from .costbasis import held_across_wallets, split_symbol
from .dailypnl import collect_flows, daily_credits, daily_spot_pnl
from .common import (
    STABLE_ASSETS, WALLET_KIND, dec, dec0, guard, ms_to_iso, price_map,
    usd_price, usd_value,
)
# 资产页唯一一处非 Binance 数据：正股的昨收。Binance 的股票接口只有买一卖一，
# 没有任何日线或前收，而"今天涨跌了多少"必须有昨收。见 `_equity_daily`。
from ..data.yahoo_source import fetch_daily_adjclose

# 合约 income 与 userTrades 都只保留 90 天，这是接口的硬上限，不是选择。
# 日历图与"今日已实现"都按这个窗口取。
WINDOW_DAYS = 90
MS_DAY = 86_400_000

# 成员只能看 90 天以内。管理员看全量——现货成交没有时间上限，能一直回溯到开户。
MEMBER_MAX_DAYS = 90

# 每个来源的缓存时长。Binance 的 IP 权重上限 6000/分钟，这些数字是照着权重定的。
TTL = {
    "prices": 30,
    "wallets": 60,
    "spot": 60,
    "futures": 30,
    "futures_metadata": 1800,
    "brackets": 86_400,
    "stocks": 21_600,
    "account": 300,
    "earn": 300,
    "margin": 60,
    "income": 300,
    "transfers": 300,
    # 提现历史单次权重 **18000**（账户维度，10 次/秒），是所有端点里最贵的一个。
    # 30 天窗口的充提合计在 5 分钟里不会有意义地变化，单独放长到 15 分钟，
    # 与流水页对齐。充值那半边权重只有 1，照旧 300 秒。
    "withdrawals": 900,
    # 成交历史只增不改，重放一次就够。放长不是省权重（单次 20 很便宜），
    # 是因为全量重放要翻页，页数随成交笔数增长。
    "trades": 21_600,
    # 日线收盘：一整个 UTC 日里是个定值，但**跨过零点就得换一根**。
    # 放太长的话，日切之后今天那一格还在拿前天的收盘当基准。单次权重 2。
    "closes": 900,
    # 逐日盈亏要用的几类进出。都是只增不改的历史，放长一点——
    # 它们只在"某天多了/少了几个币"时才影响结果，分钟级的新鲜度没有意义。
    "flows": 1800,
}


def _trade_jobs(client: BinanceClient, symbols: list[str]
                ) -> list[tuple[str, int, Any]]:
    """现货成交，按交易对一个来源。

    必须第二阶段取：`myTrades` 的 symbol 必填，而"交易过哪些对"要先看余额，
    余额本身又是第一阶段的来源。Binance 没有"我交易过哪些对"的接口。
    """
    return [(f"trades.{sym}", TTL["trades"],
             (lambda s=sym: client.spot_trades_since(s))) for sym in symbols]


def _close_jobs(client: BinanceClient, symbols: list[str]
                ) -> list[tuple[str, int, Any]]:
    """日线收盘，按交易对一个来源。公开端点、不签名、单次权重 2。

    多取两根：算窗口第一天的盈亏要用到它前一天的收盘，而最后一根是**今天这根**、
    还在走（它的 close 就是现价）。少取一根的话第一天永远算不出来。
    """
    return [(f"close.{sym}", TTL["closes"],
             (lambda s=sym: client.klines(s, interval="1d", limit=WINDOW_DAYS + 2)))
            for sym in symbols]


def _stock_quote_jobs(client: BinanceClient, symbols: list[str]
                      ) -> list[tuple[str, int, Any]]:
    return [(f"equity.quote.{symbol}", TTL["prices"],
             (lambda s=symbol: client.equity_quote(s))) for symbol in symbols]


def _closes(results: dict[str, SourceResult], symbols: list[str]
            ) -> dict[str, dict[str, float]]:
    """`{资产: {日期: 当日 UTC 收盘价}}`。

    日线的 `openTime` 就是那个 UTC 日的零点，拿它当日期。今天这根还没收，
    它的 close 是此刻的现价——正是"到现在为止今天涨跌了多少"要的那个数。
    """
    out: dict[str, dict[str, float]] = {}
    for sym in symbols:
        got = results.get(f"close.{sym}")
        rows = got.payload if (got and got.ok) else None
        if not isinstance(rows, list):
            continue
        pair = split_symbol(sym)
        if not pair:
            continue
        series: dict[str, float] = {}
        for row in rows:
            if not isinstance(row, list) or len(row) < 5:
                continue
            day = (ms_to_iso(row[0]) or "")[:10]
            close = dec(row[4])
            if day and close is not None and close > 0:
                series[day] = close
        if series:
            out[pair[0]] = series
    return out


def _equity_daily(symbol: str, *, days: int) -> list[list]:
    """正股的日线收盘。

    **Binance 的股票接口没有日线，也没有前收**：`equity/market/quote` 只给买一卖一
    （binance-sdk-stocks 1.2.0 复核，2026-09-22），另外十五个端点都是下单与查单。
    所以"今天涨跌了多少"里正股那一份只能另取行情，这里复用仓库里已有的
    Yahoo 日线源（免 key，返回复权收盘）。**这是资产页上唯一一处非 Binance 数据**，
    接口里如实标出来（`pnl.equity_close_source`）。

    返回 `[[日期, 收盘], ...]`，形状简单是为了能原样进缓存表。
    """
    start = int((datetime.now(timezone.utc) - timedelta(days=days + 14)).timestamp())
    return [[ts.date().isoformat(), close]
            for ts, close in fetch_daily_adjclose(symbol, start=start)]


def _equity_close_jobs(symbols: list[str]) -> list[tuple[str, int, Any]]:
    return [(f"close.equity.{symbol}", TTL["closes"],
             (lambda s=symbol: _equity_daily(s, days=WINDOW_DAYS)))
            for symbol in symbols]


def _equity_closes(results: dict[str, SourceResult], symbols: list[str],
                   *, days: int, now: datetime) -> dict[str, dict[str, float]]:
    """正股的 `{代码: {日期: 收盘}}`，**按日历补齐**。

    股票周末与假日没有行情，而盯市是逐个 UTC 日走的：缺一天就会被当成"这天算不出来"，
    把整张日历的那一格抹空。所以这里把最近一根收盘向后延到下一根出现为止——
    周六的市值本来就等于周五的收盘，当天涨跌是 0，这不是近似。
    """
    today = now.astimezone(timezone.utc).date()
    # 多补一天：算窗口第一天要用到它的前一天
    dates = [(today - timedelta(days=back)).isoformat() for back in range(days, -1, -1)]
    out: dict[str, dict[str, float]] = {}
    for symbol in symbols:
        got = results.get(f"close.equity.{symbol}")
        rows = got.payload if (got and got.ok) else None
        if not isinstance(rows, list):
            continue
        bars = {}
        for row in rows:
            if isinstance(row, list) and len(row) >= 2:
                close = dec(row[1])
                if row[0] and close is not None and close > 0:
                    bars[str(row[0])] = close
        if not bars:
            continue
        series: dict[str, float] = {}
        last: float | None = None
        for day in dates:
            last = bars.get(day, last)
            if last is not None:
                series[day] = last
        if series:
            out[symbol] = series
    return out


def _funding_balances(wallet_rows: Any) -> list[dict]:
    """资金钱包里的币，规范成 `{asset, qty}`。

    正股（`EQ_` 开头）不在这里：它按股票代码单独计量，日线也另取，见 `_equity_daily`。
    """
    out = []
    for wallet in wallet_rows or []:
        if not isinstance(wallet, dict):
            continue
        if WALLET_KIND.get(str(wallet.get("walletName", ""))) != "funding":
            continue
        for balance in wallet.get("assetBalances", []) or []:
            if not isinstance(balance, dict):
                continue
            asset = str(balance.get("asset", ""))
            qty = (dec0(balance.get("free")) + dec0(balance.get("locked"))
                   + dec0(balance.get("freeze")) + dec0(balance.get("withdrawing")))
            if asset and not asset.startswith(EQUITY_ASSET_PREFIX) and qty > 0:
                out.append({"asset": asset, "qty": qty})
    return out


_NO_DAILY = {"days": {}, "today_by_asset": [], "unknown_days": [],
             "unbalanced_assets": [], "unpriced_assets": []}
_NO_CREDITS = {"days": {}, "today_by_asset": [], "unpriced_assets": []}


def _flow_jobs(client: BinanceClient, start_ms: int, end_ms: int
               ) -> list[tuple[str, int, Any]]:
    """会改变某个币持有量的几类进出，逐日盈亏靠它们把历史持仓量回滚出来。

    **钱包之间的划转不在这里**：持有量按跨钱包统计，划转两头相抵。
    闪兑与小额兑换的接口只回 30 天，那是硬限——更早的日子回滚不到，
    `dailypnl` 会把受影响的天报成空，而不是给一个错的数。
    """
    return [
        ("flows.earn_flexible", TTL["flows"],
         lambda: client.earn_flexible_rewards(start_ms=start_ms, end_ms=end_ms)),
        # 正股成交：买入当天的持仓量要能回滚，否则买入那天会被当成"白涨这么多"
        ("flows.equity_trades", TTL["flows"],
         lambda: client.equity_trade_history(start_ms=start_ms, end_ms=end_ms)),
        ("flows.earn_locked", TTL["flows"],
         lambda: client.earn_locked_rewards(start_ms=start_ms, end_ms=end_ms)),
        ("flows.interest", TTL["flows"],
         lambda: client.margin_interest_history(start_ms=start_ms, end_ms=end_ms)),
        ("flows.convert", TTL["flows"],
         lambda: client.convert_trade_flow(start_ms=start_ms, end_ms=end_ms)),
        ("flows.dust", TTL["flows"],
         lambda: client.dust_log(start_ms=start_ms, end_ms=end_ms)),
    ]


def _cost_symbols(held: dict[str, float], prices: dict[str, float]) -> list[str]:
    """要回放成交的交易对。

    持有的每个币配一个 USDT 对——这是能做到的最好近似。**已经卖光的币查不到**：
    它不在余额里，就没有线索指向它的交易对，而它的已实现盈亏是真金白银。
    这条限制在接口里如实说出来（`coverage`），不假装总数是全的。
    """
    out = []
    for asset, qty in held.items():
        # 现金不回放也不拉日线：既省一次调用，也免得报价噪声变成盈亏
        if qty <= 0 or asset in STABLE_ASSETS:
            continue
        pair = f"{asset}USDT"
        if pair in prices:
            out.append(pair)
    return sorted(out)


def _window_ms(now: datetime) -> tuple[int, int]:
    end = int(now.timestamp() * 1000)
    return end - WINDOW_DAYS * MS_DAY, end


def _jobs(client: BinanceClient, now: datetime) -> list[tuple[str, int, Callable[[], Any]]]:
    start_ms, end_ms = _window_ms(now)
    return [
        ("prices", TTL["prices"], client.spot_prices),
        ("wallets", TTL["wallets"], client.wallet_balance),
        ("spot", TTL["spot"], client.user_asset),
        ("futures.account", TTL["futures"], client.futures_account),
        ("futures.config", TTL["futures"], client.futures_account_config),
        ("futures.symbol_config", TTL["futures"], client.futures_symbol_config),
        ("futures.risk", TTL["futures"], client.futures_position_risk),
        ("futures.adl", TTL["futures"], client.futures_adl_quantile),
        ("futures.symbol_adl", TTL["futures_metadata"], client.futures_symbol_adl_risk),
        ("futures.exchange_info", TTL["futures_metadata"], client.futures_exchange_info),
        ("futures.schedule", TTL["futures_metadata"], client.futures_trading_schedule),
        ("futures.brackets", TTL["brackets"], client.leverage_brackets),
        ("equity.exchange_info", TTL["stocks"], client.equity_exchange_info),
        ("equity.tokenized", TTL["stocks"], client.equity_tokenized_assets),
        ("account.info", TTL["account"], client.account_info),
        ("account.restrictions", TTL["account"], client.api_restrictions),
        ("earn.flexible", TTL["earn"], client.earn_flexible_positions),
        ("earn.locked", TTL["earn"], client.earn_locked_positions),
        ("bfusd.rate", TTL["earn"], client.bfusd_rate_history),
        ("income", TTL["income"],
         lambda: client.futures_income(start_ms=start_ms, end_ms=end_ms)),
        ("transfers.deposits", TTL["transfers"],
         lambda: client.deposits(start_ms=start_ms, end_ms=end_ms)),
        ("transfers.withdrawals", TTL["withdrawals"],
         lambda: client.withdrawals(start_ms=start_ms, end_ms=end_ms)),
        *_flow_jobs(client, start_ms, end_ms),
    ]


# 哪些来源是"会变的"。
#
# 页面顶上那个「截至 X」说的是**这些数字有多新**。成交历史（`trades.*`）缓存 6 小时，
# 因为它只增不改；把它算进页面时刻，整页会被拖成"已过期"，而余额其实是 60 秒内的。
#
# 它们各自的真实年龄没有被藏起来：每个来源自己的 as_of 照常返回，
# 界面上的「取数状态」一格一格地显示。
LIVE_CADENCE = frozenset({"prices", "wallets", "spot", "futures", "earn", "bfusd", "margin",
                          "isolated_margin", "liquidation_loan", "portfolio_margin",
                          "income", "transfers"})

# 贵到不该被"重新取数"穿透的来源。提现历史单次权重 18000（账户维度 10 次/秒），
# 是所有端点里最贵的；杠杆档位与 BFUSD 公布年化也不会随页面刷新变化。
# 用户连点几下就能把权重预算打空，然后所有页面一起 429。
NEVER_FORCE = frozenset({
    "futures.brackets", "transfers.withdrawals",
    "bfusd.rate",
})

# 契约里的来源各自由哪些子调用支撑。primary 决定状态，extra 只在失败时补一句说明。
_CONTRACT_SOURCES: dict[str, tuple[str, tuple[str, ...]]] = {
    "prices": ("prices", ()),
    "wallets": ("wallets", ()),
    "spot": ("spot", ()),
    "futures": ("futures.account", ("futures.config", "futures.symbol_config",
                                      "futures.risk", "futures.adl",
                                      "futures.symbol_adl", "futures.exchange_info",
                                      "futures.schedule", "futures.brackets")),
    "stocks": ("equity.tokenized", (
        "wallets", "equity.exchange_info",
    )),
    "account": ("account.info", ("account.restrictions",)),
    "earn": ("earn.flexible", ("earn.locked",)),
    "bfusd": ("bfusd.rate", ()),
    "margin": ("margin", ()),
    "isolated_margin": ("isolated_margin", ()),
    "liquidation_loan": ("liquidation_loan", ()),
    "portfolio_margin": ("portfolio_margin", ()),
    "income": ("income", ()),
    "transfers": ("transfers.deposits", ("transfers.withdrawals",)),
}


def _states(results: dict[str, SourceResult],
            parse_errors: dict[str, str] | None = None) -> list[dict]:
    parse_errors = parse_errors or {}
    out = []
    for key, (primary, extras) in _CONTRACT_SOURCES.items():
        head = results.get(primary)
        if head is None:
            continue
        state = {"key": key, "status": head.status,
                 "as_of": head.as_of.isoformat() if head.as_of else None,
                 "detail": head.detail}
        # 主调用成功但某个补充调用挂了：状态仍是 ok（数据能用），但把缺了什么说出来，
        # 免得界面上出现"来源正常却少了强平价"这种说不清的情形。
        if state["status"] == "ok":
            # 取到了但装配失败：数据是坏的，不能报 ok
            if key in parse_errors:
                state["status"] = "unsupported"
                state["detail"] = parse_errors[key]
            else:
                missing = [k for k in extras if results.get(k) is None or not results[k].ok]
                if missing:
                    state["detail"] = "部分补充数据取不到：" + "、".join(missing)
        out.append(state)
    return out


def _fresh_payload(results: dict[str, SourceResult], key: str) -> Any:
    """只把本次成功的来源用于成本、报价等会被用户当作当前值的派生数据。"""
    got = results.get(key)
    return got.payload if got and got.ok else None


# --- 各块的组装 -----------------------------------------------------------

def _wallets(rows: Any, btc_usd: float | None) -> list[dict]:
    """/sapi/v1/asset/wallet/balance 的 balance 是 **BTC 计价**的。"""
    out = []
    for row in rows or []:
        name = row.get("walletName", "")
        btc = dec(row.get("balance"))
        out.append({
            "kind": WALLET_KIND.get(name, name.lower().replace(" ", "_").replace("-", "_")),
            "btc_valuation": btc,
            "value_usd": None if (btc is None or btc_usd is None) else btc * btc_usd,
            "activate": bool(row.get("activate", True)),
        })
    return out


# 直接买入的正股在钱包明细里的资产代码前缀：SOXL 记作 EQ_SOXL，放在资金钱包。
# 文档没写，2026-09-17 线上实测（Stocks Trading 本身没有持仓查询端点）。
EQUITY_ASSET_PREFIX = "EQ_"
STOCKS_COVERAGE = (
    "Binance Stocks 没有持仓查询接口。正股持仓取自钱包明细里 EQ_ 开头的资产，"
    "数量与钱包一致；市值沿用 Binance 钱包估值。Binance 暂未提供完整成本与手续费，"
    "由管理员为当前持仓录入单位成本价和手续费；持仓数量变化后需重新录入。"
)


def _stock_positions(equities: list[dict], assets: list[dict],
                     manual_costs: dict[str, dict], exchange_info: Any,
                     quotes: dict[str, Any]) -> tuple[list[dict], dict]:
    grouped: dict[str, dict] = {}

    def group(symbol: str, name: str) -> dict:
        row = grouped.setdefault(symbol, {
            "symbol": symbol,
            "name": name,
            "direct_qty": 0.0,
            "tokenized_qty": 0.0,
            "available_qty": 0.0,
            "locked_qty": 0.0,
            "freeze_qty": 0.0,
            "withdrawing_qty": 0.0,
            "values": [],
            "value_complete": True,
        })
        if not row["name"] and name:
            row["name"] = name
        return row

    for holding in equities:
        row = group(holding["symbol"], holding["name"])
        row["direct_qty"] += holding["qty"]
        row["available_qty"] += holding["free_qty"]
        row["locked_qty"] += holding["locked_qty"]
        row["freeze_qty"] += holding["freeze_qty"]
        row["withdrawing_qty"] += holding["withdrawing_qty"]
        if holding["value_usd"] is None:
            row["value_complete"] = False
        else:
            row["values"].append(holding["value_usd"])

    for holding in assets:
        multiplier = holding["multiplier"]
        if multiplier is None:
            continue
        row = group(holding["symbol"], holding["name"])
        row["tokenized_qty"] += holding["qty"] * multiplier
        row["available_qty"] += holding["free_qty"] * multiplier
        row["locked_qty"] += holding["locked_qty"] * multiplier
        row["freeze_qty"] += holding["freeze_qty"] * multiplier
        row["withdrawing_qty"] += holding["withdrawing_qty"] * multiplier
        if holding["value_usd"] is None:
            row["value_complete"] = False
        else:
            row["values"].append(holding["value_usd"])

    metadata_by = {
        str(row.get("symbol", "")).upper(): row
        for row in (exchange_info or {}).get("symbols", [])
        if isinstance(row, dict) and row.get("symbol")
    } if isinstance(exchange_info, dict) else {}
    positions = []
    for symbol, aggregate in grouped.items():
        total_qty = aggregate["direct_qty"] + aggregate["tokenized_qty"]
        wallet_value = sum(aggregate["values"]) if aggregate["value_complete"] else None
        wallet_price = wallet_value / total_qty if wallet_value is not None and total_qty > 0 else None

        raw_quote = quotes.get(symbol)
        quote = raw_quote if (isinstance(raw_quote, dict)
                              and str(raw_quote.get("symbol", "")).upper() == symbol) else {}
        bid, ask = dec(quote.get("bidPrice")), dec(quote.get("askPrice"))
        bid = bid if bid is not None and bid > 0 else None
        ask = ask if ask is not None and ask > 0 else None
        mark = (bid + ask) / 2 if bid is not None and ask is not None else None
        spread = ((ask - bid) / mark * 10_000
                  if bid is not None and ask is not None and mark else None)

        saved = manual_costs.get(symbol)
        metadata = metadata_by.get(symbol, {})
        step_size = dec(metadata.get("stepSize"))
        tolerance = max(1e-9, step_size / 2 if step_size is not None and step_size > 0 else 1e-8)
        saved_qty = dec(saved.get("position_qty")) if saved else None
        matches = saved_qty is not None and abs(saved_qty - total_qty) <= tolerance
        status = "manual" if matches else "stale" if saved else "missing"
        cost_price = dec(saved.get("cost_price_usd")) if saved else None
        commission = dec(saved.get("commission_usd")) if saved else None
        cost_basis = (cost_price * total_qty + commission
                      if matches and cost_price is not None and commission is not None else None)
        average = cost_basis / total_qty if cost_basis is not None and total_qty > 0 else None
        unrealized = (mark * total_qty - cost_basis
                      if mark is not None and cost_basis is not None else None)
        updated_at = saved.get("updated_at") if saved else None
        positions.append({
            "symbol": symbol,
            "name": aggregate["name"],
            "direct_qty": aggregate["direct_qty"],
            "tokenized_qty": aggregate["tokenized_qty"],
            "available_qty": aggregate["available_qty"],
            "locked_qty": aggregate["locked_qty"],
            "freeze_qty": aggregate["freeze_qty"],
            "withdrawing_qty": aggregate["withdrawing_qty"],
            "total_qty": total_qty,
            "wallet_price_usd": wallet_price,
            "wallet_value_usd": wallet_value,
            "bid_usd": bid,
            "ask_usd": ask,
            "mark_price_usd": mark,
            "spread_bps": spread,
            "tradability": str(metadata.get("tradability", "")) or None,
            "fractionable": bool(metadata.get("fractionable", False)),
            "fractionable_extended": bool(metadata.get("fractionableEh", False)),
            "extended_session": bool(metadata.get("extendedSession", False)),
            "overnight_supported": bool(metadata.get("overnightSupported", False)),
            "cost_status": status,
            "cost_price_usd": cost_price,
            "commission_usd": commission,
            "cost_position_qty": saved_qty,
            "cost_updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else None,
            "avg_cost_usd": average,
            "cost_basis_usd": cost_basis,
            "unrealized_pnl_usd": unrealized,
            "unrealized_pnl_pct": (unrealized / cost_basis
                                   if unrealized is not None and cost_basis else None),
        })
    positions.sort(key=lambda row: row["wallet_value_usd"]
                   if row["wallet_value_usd"] is not None else -1, reverse=True)
    return positions, {
        "manual": sum(row["cost_status"] == "manual" for row in positions),
        "stale": sum(row["cost_status"] == "stale" for row in positions),
        "total": len(positions),
    }


def _stocks(wallet_rows: Any, tokenized_rows: Any, btc_usd: float | None,
            manual_costs: dict[str, dict] | None = None, exchange_info: Any = None,
            quotes: dict[str, Any] | None = None) -> dict:
    """钱包明细里的股票：直接买入的正股（EQ_SOXL）与代币化股票（AAPLB）。

    两者都只认钱包里**实际存在的余额**，不从成交历史倒推：转入、转出和公司行动
    会让倒推的数量静默失真。
    """
    mappings = {
        str(row.get("assetCode", "")): row
        for row in tokenized_rows or []
        if isinstance(row, dict) and row.get("assetCode") and row.get("underlyingEquitySymbol")
    }
    equities = []
    assets = []
    for wallet in wallet_rows or []:
        if not isinstance(wallet, dict):
            continue
        wallet_name = str(wallet.get("walletName", ""))
        wallet_kind = WALLET_KIND.get(
            wallet_name, wallet_name.lower().replace(" ", "_").replace("-", "_"))
        for balance in wallet.get("assetBalances", []) or []:
            if not isinstance(balance, dict):
                continue
            asset_code = str(balance.get("asset", ""))
            free = dec0(balance.get("free"))
            locked = dec0(balance.get("locked"))
            freeze = dec0(balance.get("freeze"))
            withdrawing = dec0(balance.get("withdrawing"))
            qty = free + locked + freeze + withdrawing
            if qty <= 0:
                continue
            btc_value = dec(balance.get("btcValuation"))
            # 估值为 0 或缺失都当"没有估值"：持有数量是正的，0 美元不是一个真实的市值
            value = btc_value * btc_usd if (btc_value and btc_usd is not None) else None

            if asset_code.startswith(EQUITY_ASSET_PREFIX) and len(asset_code) > len(EQUITY_ASSET_PREFIX):
                equities.append({
                    "asset_code": asset_code,
                    "symbol": asset_code[len(EQUITY_ASSET_PREFIX):],
                    "name": str(balance.get("assetName", "")),
                    "qty": qty,
                    "free_qty": free,
                    "locked_qty": locked,
                    "freeze_qty": freeze,
                    "withdrawing_qty": withdrawing,
                    "price_usd": None if value is None else value / qty,
                    "value_usd": value,
                    "wallet": wallet_kind,
                })
                continue

            mapping = mappings.get(asset_code)
            if mapping is None:
                continue
            multiplier_valid = mapping.get("multiplierValid") is True
            multiplier = dec(mapping.get("multiplier")) if multiplier_valid else None
            assets.append({
                "asset_code": asset_code,
                "name": str(mapping.get("assetName", "")),
                "symbol": str(mapping.get("underlyingEquitySymbol", "")),
                "qty": qty,
                "free_qty": free,
                "locked_qty": locked,
                "freeze_qty": freeze,
                "withdrawing_qty": withdrawing,
                "multiplier": multiplier,
                "multiplier_valid": multiplier_valid,
                "underlying_qty": None if multiplier is None else qty * multiplier,
                "value_usd": value,
                "wallet": wallet_kind,
            })
    by_value = lambda row: row["value_usd"] if row["value_usd"] is not None else -1  # noqa: E731
    equities.sort(key=by_value, reverse=True)
    assets.sort(key=by_value, reverse=True)
    positions, cost_coverage = _stock_positions(
        equities, assets, manual_costs or {}, exchange_info, quotes or {})
    return {
        "standalone_positions_available": False,
        "coverage_detail": STOCKS_COVERAGE,
        "equity_holdings": equities,
        "tokenized_assets": assets,
        "positions": positions,
        "cost_coverage": cost_coverage,
    }


def _capabilities(info: Any, restrictions: Any) -> dict | None:
    if not isinstance(info, dict):
        return None
    permissions = restrictions if isinstance(restrictions, dict) else {}

    def permission(key: str) -> bool | None:
        return bool(permissions[key]) if key in permissions else None

    vip = dec(info.get("vipLevel"))
    return {
        "vip_level": int(vip) if vip is not None else None,
        "reading": permission("enableReading"),
        "ip_restricted": permission("ipRestrict"),
        "margin": bool(info.get("isMarginEnabled", False)),
        "futures": bool(info.get("isFutureEnabled", False)),
        "options": bool(info.get("isOptionsEnabled", False)),
        "portfolio_margin": bool(info.get("isPortfolioMarginRetailEnabled", False)),
        "trade_permissions": {
            "spot_margin": permission("enableSpotAndMarginTrading"),
            "margin": permission("enableMargin"),
            "futures": permission("enableFutures"),
            "options": permission("enableVanillaOptions"),
            "portfolio_margin": permission("enablePortfolioMarginTrading"),
            "withdrawals": permission("enableWithdrawals"),
        },
    }


def _margin_leg(payload: Any, prices: dict[str, float]) -> dict:
    row = payload if isinstance(payload, dict) else {}
    asset = str(row.get("asset", ""))
    net = dec0(row.get("netAsset"))
    return {
        "asset": asset,
        "free": dec0(row.get("free")),
        "locked": dec0(row.get("locked")),
        "borrowed": dec0(row.get("borrowed")),
        "interest": dec0(row.get("interest")),
        "net": net,
        "value_usd": usd_value(asset, net, prices),
    }


def _isolated_margin(payload: Any, btc_usd: float | None,
                     prices: dict[str, float]) -> dict | None:
    if not isinstance(payload, dict):
        return None

    def btc_value(key: str) -> float | None:
        value = dec(payload.get(key))
        return None if value is None or btc_usd is None else value * btc_usd

    pairs = []
    for row in payload.get("assets", []) or []:
        if not isinstance(row, dict) or not row.get("enabled", True):
            continue
        level = dec(row.get("marginLevel"))
        pairs.append({
            "symbol": str(row.get("symbol", "")),
            "enabled": bool(row.get("enabled", True)),
            "trade_enabled": bool(row.get("tradeEnabled", False)),
            "margin_level": None if level is None or level >= 999 else level,
            "margin_level_status": str(row.get("marginLevelStatus", "")) or None,
            "margin_ratio": dec(row.get("marginRatio")),
            "index_price": dec(row.get("indexPrice")),
            "liquidation_price": dec(row.get("liquidatePrice")),
            "liquidation_rate": dec(row.get("liquidateRate")),
            "base": _margin_leg(row.get("baseAsset"), prices),
            "quote": _margin_leg(row.get("quoteAsset"), prices),
        })
    pairs.sort(key=lambda row: row["margin_level"] if row["margin_level"] is not None else 999)
    return {
        "total_asset_usd": btc_value("totalAssetOfBtc"),
        "total_liability_usd": btc_value("totalLiabilityOfBtc"),
        "total_net_asset_usd": btc_value("totalNetAssetOfBtc"),
        "pairs": pairs,
    }


def _liquidation_loan(payload: Any) -> dict | None:
    # 没有借款时接口回空响应，客户端换成 `{}`（见 client.margin_liquidation_loan）。
    # 那是"没有记录"，不是"一笔 0 元的借款"：块为 null，来源状态照常 ok。
    if not isinstance(payload, dict) or not payload:
        return None
    return {
        "asset": str(payload.get("asset", "")),
        "amount": dec0(payload.get("amount")),
        "repaid_amount": dec0(payload.get("repaidAmount")),
        "remaining_amount": dec0(payload.get("remainingAmount")),
    }


def _portfolio_margin(summary: Any, um_account: Any, um_risk: Any,
                      account_type: str) -> dict | None:
    if not isinstance(summary, dict):
        return None
    normalized_type = account_type.upper()
    # 官方同一页对 PM_1 的文案同时出现过 “PM PRO” 与 “classic PM”，不把这组
    # 营销名称固化进契约；精确模式由 account_type 保留，只有 PM_3 的 SPAN 可稳定区分。
    mode = "span" if normalized_type == "PM_3" else "portfolio"
    risk_by = {
        (row.get("symbol"), row.get("positionSide", "BOTH")): row
        for row in um_risk or [] if isinstance(row, dict)
    }
    positions = []
    account = um_account if isinstance(um_account, dict) else {}
    for row in account.get("positions", []) or []:
        if not isinstance(row, dict):
            continue
        amount = dec0(row.get("positionAmt"))
        if amount == 0:
            continue
        symbol = str(row.get("symbol", ""))
        side = str(row.get("positionSide", "BOTH"))
        risk = risk_by.get((symbol, side), {})
        mark = dec(risk.get("markPrice"))
        liq = dec(risk.get("liquidationPrice"))
        positions.append({
            "symbol": symbol,
            "position_side": {"LONG": "long", "SHORT": "short"}.get(side, "both"),
            "position_amt": amount,
            "notional_usd": abs(dec0(row.get("notional")) or amount * (mark or 0)),
            "entry_price": dec0(row.get("entryPrice")),
            "mark_price": mark,
            "liquidation_price": None if liq is None or liq <= 0 else liq,
            "unrealized_pnl_usd": dec0(row.get("unrealizedProfit")),
        })
    return {
        "mode": mode,
        "account_type": account_type or None,
        "account_status": str(summary.get("accountStatus", "")) or None,
        "uni_mmr": dec(summary.get("uniMMR")),
        "equity_usd": dec(summary.get("accountEquity")),
        "actual_equity_usd": dec(summary.get("actualEquity")),
        "initial_margin_usd": dec(summary.get("accountInitialMargin")),
        "maint_margin_usd": dec(summary.get("accountMaintMargin")),
        "available_balance_usd": dec(summary.get("totalAvailableBalance")),
        "max_withdraw_usd": dec(summary.get("virtualMaxWithdrawAmount")),
        "positions": positions,
    }


def _spot(rows: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in rows or []:
        asset = row.get("asset", "")
        free, locked = dec0(row.get("free")), dec0(row.get("locked"))
        freeze, withdrawing = dec0(row.get("freeze")), dec0(row.get("withdrawing"))
        total = free + locked + freeze + withdrawing
        if total <= 0:
            continue
        out.append({
            "asset": asset, "free": free, "locked": locked, "freeze": freeze,
            "withdrawing": withdrawing, "total": total,
            "price_usd": usd_price(asset, prices),
            "value_usd": usd_value(asset, total, prices),
        })
    out.sort(key=lambda r: r["value_usd"] if r["value_usd"] is not None else -1, reverse=True)
    return out


_TRADFI_UNDERLYING_TYPES = frozenset({
    "EQUITY", "COMMODITY", "KR_EQUITY", "HK_EQUITY", "CN_EQUITY",
})


def _schedule_session(schedule: Any, underlying_type: str | None, now_ms: int) -> str | None:
    if not underlying_type or not isinstance(schedule, dict):
        return None
    market = schedule.get("marketSchedules", {}).get(underlying_type, {})
    sessions = market.get("sessions", []) if isinstance(market, dict) else []
    for session in sessions:
        if not isinstance(session, dict):
            continue
        start, end = dec(session.get("startTime")), dec(session.get("endTime"))
        if start is not None and end is not None and start <= now_ms < end:
            return str(session.get("type") or "") or None
    return "CLOSED" if sessions else None


def _futures(account: Any, config: Any, risk: Any, adl: Any, brackets: Any,
             exchange_info: Any = None, schedule: Any = None, symbol_adl: Any = None,
             prices: dict[str, float] | None = None,
             now: datetime | None = None, symbol_config: Any = None) -> dict | None:
    if not isinstance(account, dict):
        return None

    # positionRisk 才有标记价、强平价与（v3 起）开仓价；account 里只有保证金与未实现盈亏
    risk_by = {}
    for row in risk or []:
        risk_by[(row.get("symbol"), row.get("positionSide", "BOTH"))] = row
    # v3 的 account 与 positionRisk 都没有杠杆倍数和逐仓标记，只有 symbolConfig 有
    symbol_config_by = {
        row.get("symbol"): row
        for row in symbol_config or []
        if isinstance(row, dict) and row.get("symbol")
    } if isinstance(symbol_config, list) else {}
    adl_by = {r.get("symbol"): r.get("adlQuantile", {}) for r in adl or []}
    metadata_by = {
        row.get("symbol"): row
        for row in (exchange_info or {}).get("symbols", [])
        if isinstance(row, dict) and row.get("symbol")
    } if isinstance(exchange_info, dict) else {}
    symbol_adl_rows = symbol_adl.get("symbols", []) if isinstance(symbol_adl, dict) else symbol_adl
    symbol_adl_by = {
        row.get("symbol"): row.get("adlRisk")
        for row in symbol_adl_rows or []
        if isinstance(row, dict) and row.get("symbol")
    }
    now_ms = int((now or datetime.now(timezone.utc)).timestamp() * 1000)
    brackets_by = {}
    for row in brackets or []:
        if not isinstance(row, dict):
            continue
        # notionalCoef 是账户被单独调整档位时的倍率。它移动每个档位边界；cum 也必须
        # 同倍缩放，才能让 `notional × rate − cum` 在新边界两侧保持连续。
        coef = dec(row.get("notionalCoef")) or 1.0
        tiers = []
        for tier in row.get("brackets", []):
            if not isinstance(tier, dict):
                continue
            cap = dec(tier.get("notionalCap"))
            tiers.append({
                "notional_floor_usd": dec0(tier.get("notionalFloor")) * coef,
                "notional_cap_usd": None if cap is None else cap * coef,
                "maint_margin_rate": dec0(tier.get("maintMarginRatio")),
                "maint_amount_usd": dec0(tier.get("cum")) * coef,
            })
        brackets_by[row.get("symbol", "")] = tiers

    positions = []
    for row in account.get("positions", []):
        amt = dec0(row.get("positionAmt"))
        if amt == 0:
            continue
        symbol = row.get("symbol", "")
        side = row.get("positionSide", "BOTH")
        r = risk_by.get((symbol, side), {})
        mark = dec(r.get("markPrice"))
        liq = dec(r.get("liquidationPrice"))
        liq = None if (liq is None or liq <= 0) else liq
        notional = abs(dec0(row.get("notional")) or (abs(amt) * (mark or 0)))
        # 强平价拿不到就没有"距强平"。这里曾用 1/杠杆 − 维持保证金率兜底，那是错的：
        # 它是**逐仓**的公式，而 Binance 恰恰在全仓且账户余额充足时才不给强平价——
        # 也就是最安全的那些仓位会被算出最紧的数。而且它只是 1/杠杆，价格怎么动都不变，
        # 却被画成一根会变色的风险条。页面上于是出现"强平价 —，距强平 9.5%"。
        distance = abs(mark - liq) / mark if (liq is not None and mark) else None
        quantile = adl_by.get(symbol, {})
        adl_q = quantile.get(side) if isinstance(quantile, dict) else None
        if adl_q is None and isinstance(quantile, dict):
            adl_q = quantile.get("BOTH")
        metadata = metadata_by.get(symbol, {})
        underlying_type = metadata.get("underlyingType")
        underlying_subtypes = metadata.get("underlyingSubType")
        if not isinstance(underlying_subtypes, list):
            underlying_subtypes = []
        entry = dec0(r.get("entryPrice"))
        sym_config = symbol_config_by.get(symbol, {})
        margin_type = str(sym_config.get("marginType", "")).upper()
        positions.append({
            "symbol": symbol,
            "position_side": {"BOTH": "both", "LONG": "long", "SHORT": "short"}.get(side, "both"),
            "position_amt": amt,
            "notional_usd": notional,
            "entry_price": entry,
            "mark_price": mark if mark is not None else entry,
            "liquidation_price": liq,
            "liq_distance": distance,
            "leverage": int(dec0(sym_config.get("leverage")) or 1),
            # symbolConfig 取不到时退回 positionRisk：逐仓仓位的 isolatedWallet 才大于 0。
            # 全当全仓的话，压力测试不会报出逐仓仓位各自触及强平价（stress.ts 的 liquidated）
            "isolated": (margin_type == "ISOLATED" if margin_type
                         else dec0(r.get("isolatedWallet")) > 0),
            "unrealized_pnl_usd": dec0(row.get("unrealizedProfit")),
            "initial_margin_usd": dec0(row.get("positionInitialMargin")
                                       or row.get("initialMargin")),
            "maint_margin_usd": dec0(row.get("maintMargin")),
            "maintenance_brackets": brackets_by.get(symbol, []),
            "adl_quantile": int(adl_q) if adl_q is not None else None,
            "tradfi": underlying_type in _TRADFI_UNDERLYING_TYPES,
            "underlying_type": underlying_type,
            "underlying_subtypes": [str(value) for value in underlying_subtypes],
            "market_session": _schedule_session(schedule, underlying_type, now_ms),
            "symbol_adl_risk": symbol_adl_by.get(symbol),
        })

    margin_balance = dec0(account.get("totalMarginBalance"))
    maint = dec0(account.get("totalMaintMargin"))
    cfg = config if isinstance(config, dict) else {}
    return {
        "dual_side_position": bool(cfg.get("dualSidePosition", False)),
        "multi_assets_margin": bool(account.get("multiAssetsMargin",
                                                cfg.get("multiAssetsMargin", False))),
        "total_wallet_balance": dec0(account.get("totalWalletBalance")),
        "total_margin_balance": margin_balance,
        "total_unrealized_pnl": dec0(account.get("totalUnrealizedProfit")),
        "total_initial_margin": dec0(account.get("totalInitialMargin")),
        "total_maint_margin": maint,
        "available_balance": dec0(account.get("availableBalance")),
        "max_withdraw": dec0(account.get("maxWithdrawAmount")),
        "margin_ratio": (maint / margin_balance) if margin_balance > 0 else None,
        "positions": positions,
        # 合约钱包里逐个币的余额。把 BNB 划进来当保证金 / 抵手续费是常见做法，
        # 只看现货余额的话这些币就凭空消失了——成本基础按"账户一共有多少"算，
        # 不认钱包。
        "assets": [
            {"asset": a.get("asset", ""),
             "wallet_balance": dec0(a.get("walletBalance")),
             "margin_balance": dec0(a.get("marginBalance")),
             "available": dec0(a.get("availableBalance")),
             # 界面上"合约里的现货持仓"要按 USD 排序与合计。取不到报价就是 null，
             # 不记 0——0 是一个有效余额。
             "value_usd": usd_value(a.get("asset", ""),
                                    dec0(a.get("walletBalance")), prices or {})}
            for a in account.get("assets", [])
            if dec0(a.get("walletBalance")) != 0 or dec0(a.get("marginBalance")) != 0
        ],
    }


_TIER_KEY = re.compile(r"^\s*([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)")


def _apr_tiers(raw: Any, amount: float, base: float | None) -> tuple[float | None, list[dict]]:
    """活期理财的**阶梯年化**：档内那部分按档位利率，超出的按实时年化。

    `tierAnnualPercentageRate` 形如 `{"0-5BTC": 0.05, "5-10BTC": 0.03}`——键里的
    数是资产本身的数量区间，后缀是币种。Binance 按档累加（像税率级距），不是
    "落在哪一档整笔就按那一档"，所以界面上该给的是**按当前金额加权后的那个数**。

    原先这里直接报 `latestAnnualPercentageRate`，那只是超出阶梯之后的实时利率：
    活期 USDT 的前几百块拿的是高得多的档位利率，页面上的年化因此一直偏低。

    实时利率未知而又有超出阶梯的部分时，加权值返回 `None`——报一个只算了一半的
    年化比不报更糟。档位本身照常返回，界面仍可以把它们列出来。
    """
    tiers = []
    for key, rate in (raw or {}).items() if isinstance(raw, dict) else []:
        hit = _TIER_KEY.match(str(key))
        value = dec(rate)
        if hit is None or value is None:
            continue
        low, high = float(hit.group(1)), float(hit.group(2))
        if high > low:
            tiers.append({"from": low, "to": high, "rate": value,
                          "amount": max(0.0, min(amount, high) - low)})
    tiers.sort(key=lambda t: t["from"])

    covered = sum(t["amount"] for t in tiers)
    rest = max(0.0, amount - covered)
    if amount <= 0:
        return base, tiers
    if rest > 0 and base is None:
        return None, tiers
    weighted = sum(t["amount"] * t["rate"] for t in tiers) + rest * (base or 0.0)
    return weighted / amount, tiers


def _earn(flexible: Any, locked: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in (flexible or {}).get("rows", []) if isinstance(flexible, dict) else []:
        asset = row.get("asset", "")
        amount = dec0(row.get("totalAmount"))
        rewards = dec(row.get("cumulativeTotalRewards"))
        base_apr = dec(row.get("latestAnnualPercentageRate"))
        apr, tiers = _apr_tiers(row.get("tierAnnualPercentageRate"), amount, base_apr)
        out.append({
            "product_id": row.get("productId", ""), "asset": asset, "amount": amount,
            "value_usd": usd_value(asset, amount, prices), "kind": "flexible",
            "apr": apr,
            # 实时年化与档位都留着：界面要能说清"这个年化是怎么来的"
            "apr_base": base_apr,
            "apr_tiers": tiers,
            "cumulative_rewards": rewards,
            "cumulative_rewards_usd": usd_value(asset, rewards, prices),
            "redeem_date": None, "can_redeem": bool(row.get("canRedeem", True)),
        })
    for row in (locked or {}).get("rows", []) if isinstance(locked, dict) else []:
        asset = row.get("asset", "")
        amount = dec0(row.get("amount"))
        reward_asset = row.get("rewardAsset") or asset
        rewards = dec(row.get("rewardAmt"))
        out.append({
            "product_id": str(row.get("positionId") or row.get("projectId") or ""),
            "asset": asset, "amount": amount,
            "value_usd": usd_value(asset, amount, prices), "kind": "locked",
            # 定期是一口价，没有阶梯
            "apr": dec(row.get("apy") or row.get("APY")),
            "apr_base": dec(row.get("apy") or row.get("APY")),
            "apr_tiers": [],
            "cumulative_rewards": rewards,
            "cumulative_rewards_usd": usd_value(reward_asset, rewards, prices),
            "redeem_date": (ms_to_iso(row.get("deliverDate")) or "")[:10] or None,
            "can_redeem": bool(row.get("canRedeemEarly", False)),
        })
    out.sort(key=lambda r: r["value_usd"] if r["value_usd"] is not None else -1, reverse=True)
    return out


def _bfusd_rate(payload: Any) -> float | None:
    """取 Binance 已公布的最近一条 BFUSD 年化；无效响应保持未知。"""
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return None
    candidates = []
    for row in payload["rows"]:
        if not isinstance(row, dict):
            continue
        rate = dec(row.get("annualPercentageRate"))
        if rate is None or rate < 0:
            continue
        candidates.append((dec0(row.get("time")), rate))
    return max(candidates, default=(0.0, None), key=lambda item: item[0])[1]


def _margin(payload: Any, btc_usd: float | None,
            prices: dict[str, float] | None = None) -> dict | None:
    """marginLevel 直接给；三个总额是 **BTC 计价**的。"""
    if not isinstance(payload, dict):
        return None
    def to_usd(key: str) -> float:
        btc = dec0(payload.get(key))
        return btc * btc_usd if btc_usd is not None else 0.0
    level = dec(payload.get("marginLevel"))
    # Binance 在无负债时返回 999 这种哨兵值，照搬会在界面上显示成一个荒谬的风险率
    if level is not None and level >= 999:
        level = None
    return {
        "margin_level": level,
        # 同上：杠杆账户里也可能躺着现货币种
        "assets": [
            {"asset": a.get("asset", ""),
             "free": dec0(a.get("free")), "locked": dec0(a.get("locked")),
             "borrowed": dec0(a.get("borrowed")), "net": dec0(a.get("netAsset")),
             "value_usd": usd_value(a.get("asset", ""), dec0(a.get("netAsset")),
                                    prices or {})}
            for a in payload.get("userAssets", [])
            if dec0(a.get("netAsset")) != 0
        ],
        "total_asset_usd": to_usd("totalAssetOfBtc"),
        "total_liability_usd": to_usd("totalLiabilityOfBtc"),
        "total_net_asset_usd": to_usd("totalNetAssetOfBtc"),
    }


_INCOME_FIELD = {
    "REALIZED_PNL": "realized_pnl",
    "FUNDING_FEE": "funding_fee",
    "SPECIAL_FUNDING_FEE": "funding_fee",
    "COMMISSION": "commission",
    "INSURANCE_CLEAR": "insurance_clear",
    "REFERRAL_KICKBACK": "referral_kickback",
    "COMMISSION_REBATE": "referral_kickback",
}


def _income(rows: Any, prices: dict[str, float] | None = None,
            since_ms: int | None = None) -> dict | None:
    """合约损益按类型汇总，**统一换算成 USD**。

    `income` 字段的单位是那一行的 `asset`，不一定是 USDT：手续费常常用 BNB 抵扣
    （`asset: "BNB", income: "-0.012"`），联合保证金下资金费也可能结在别的币上。
    不看 asset 直接相加，等于把 0.012 个 BNB 当成 0.012 美元——手续费会凭空少掉
    几十倍。换不出价的行单独计数，在界面上说出来，而不是当 0 吞掉。

    `since_ms` 把损益裁到与净值曲线同一个窗口：取数按固定 30 天拉，而曲线的实际
    长度取决于 accountSnapshot 有多少天。两边窗口不一致的话，多出来的那几天会被
    残差项吸走，表面上照样闭合。
    """
    if not isinstance(rows, list):
        return None
    prices = prices or {}
    out = {"realized_pnl": 0.0, "funding_fee": 0.0, "commission": 0.0,
           "insurance_clear": 0.0, "referral_kickback": 0.0, "other": 0.0}
    unpriced = 0
    for row in rows:
        if since_ms is not None:
            try:
                if int(row.get("time", 0)) < since_ms:
                    continue
            except (TypeError, ValueError):
                continue
        # TRANSFER 是划转，不是损益，绝不能进这里——它会把真实盈亏算错
        if row.get("incomeType") in ("TRANSFER", "INTERNAL_TRANSFER"):
            continue
        field = _INCOME_FIELD.get(row.get("incomeType", ""), "other")
        amount = dec0(row.get("income"))
        if amount == 0:
            continue
        usd = usd_value(row.get("asset", ""), amount, prices)
        if usd is None:
            unpriced += 1
            continue
        out[field] += usd
    out["unpriced_rows"] = unpriced
    return out


def _today_settled(income_rows: Any, prices: dict[str, float],
                   now: datetime) -> dict | None:
    """今天结算掉的钱**按类型拆开**。

    摘要条上「今日盈亏」点开原先只有一行「当日结算 −$12.30」，看不出那是资金费
    还是手续费——同一个合计在「合约收支」那张 90 天表里是拆开的，今天这一格却不是。

    直接复用 `_income`：分类（`_INCOME_FIELD`）、剔除 TRANSFER、非 USDT 结算的
    换算，那边都做过一遍，这里再写一份就会有两套口径。窗口换成今天的 UTC 日切，
    于是**各项之和必然等于日历最后一格的 `settled_usd`**——两者是同一批行、
    同一条日界线。
    """
    start = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return _income(income_rows, prices, since_ms=int(start.timestamp() * 1000))


def _epoch_ms(value: Any) -> int | None:
    """充提两边的时间格式不一样：充值 `insertTime` 是毫秒整数，
    提现 `applyTime` 是 `"2026-08-25 10:30:00"` 这样的 UTC 字符串。两种都认。"""
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        if value.isdigit():
            return int(value)
        try:
            dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
        return int(dt.timestamp() * 1000)
    return None


def _after(row: dict, field: str, since_ms: int | None) -> bool:
    if since_ms is None:
        return True
    at = _epoch_ms(row.get(field))
    # 时间读不出来就保守地算进窗口：宁可多算一笔充提，也不要把它当成利润
    return True if at is None else at >= since_ms


def _transfers(deposits: Any, withdrawals: Any, prices: dict[str, float],
               since_ms: int | None = None) -> dict | None:
    """`since_ms` 同 `_income`：归因表要的是与净值曲线同窗口的净充提。

    充值看 `insertTime`（到账时间），提现看 `applyTime`——提现只有申请时间是稳定的，
    完成时间字段在不同链上并不一致。窗口边界上差几分钟不影响量级。
    """
    if not isinstance(deposits, list) or not isinstance(withdrawals, list):
        return None
    dep = wit = 0.0
    dep_n = wit_n = 0
    for row in deposits:
        if int(row.get("status", 0)) != 1:      # 只算已到账的
            continue
        if not _after(row, "insertTime", since_ms):
            continue
        value = usd_value(row.get("coin", ""), dec0(row.get("amount")), prices)
        dep += value or 0.0
        dep_n += 1
    for row in withdrawals:
        if int(row.get("status", 0)) != 6:      # 6 = Completed
            continue
        if not _after(row, "applyTime", since_ms):
            continue
        value = usd_value(row.get("coin", ""), dec0(row.get("amount")), prices)
        wit += value or 0.0
        wit_n += 1
    return {"deposits_usd": dep, "withdrawals_usd": wit, "net_usd": dep - wit,
            "deposit_count": dep_n, "withdrawal_count": wit_n}




def _daily(income_rows: Any, spot_days: dict[str, float | None],
           prices: dict[str, float], days: int, now: datetime,
           credits: dict[str, dict] | None = None,
           stock_daily: dict | None = None) -> list[dict]:
    """日历的每一格：**那天到底赚了多少**。

        一天 = 持仓涨跌（现货与正股，含当天成交的那部分）
             + 当天结算掉的（合约）
             + 理财派息 − 杠杆利息

    "结算掉的"是合约那半边：已实现盈亏、资金费、手续费、返佣。它们是真金白银的
    进出，只报 REALIZED_PNL 会让"这天赚了多少"偏乐观。

    **现货那半边原来只算卖出结转，所以不成交的日子全是 0。** 那不是"这天没赚没亏"，
    是"这天没成交"——拿着 6 个 BNB 什么都不做，涨 10 块就是赚 60 块。现在按当天的
    持仓量与收盘价算，见 `dailypnl.py`。

    **现货这一侧不再有"相对成本"的任何数**：卖出那笔的盈亏已经含在市值变化里
    （卖出当天的 `数量 × (收盘 − 成交价)` 那一项）。相对终身均价的那套算法整个
    删了，理由见 `costbasis.py`。

    现货算不出来的那天（缺收盘价、或持仓量回滚出负数）整格报 `null`，
    不拿"只有合约那半边"的数冒充当天的盈亏。
    """
    settled: dict[str, float] = {}
    for row in income_rows or []:
        if row.get("incomeType") in ("TRANSFER", "INTERNAL_TRANSFER"):
            continue
        day = (ms_to_iso(row.get("time")) or "")[:10]
        if not day:
            continue
        usd = usd_value(row.get("asset", ""), dec0(row.get("income")), prices)
        if usd is None:
            continue
        settled[day] = settled.get(day, 0.0) + usd

    # 用传进来的 now，不自己读时钟：`build_portfolio` 全程用同一个 now，
    # 这里另读一次的话，测试里固定的 NOW 与真实时钟一跨天就对不上——
    # 而且真实运行时也会出现"页面时刻是昨天、日历最后一格是今天"的错位。
    earn_days = ((credits or {}).get("earn") or {}).get("days") or {}
    interest_days = ((credits or {}).get("interest") or {}).get("days") or {}
    # 正股取不到昨收时这一项按 0 记，**并在 `pnl.equity_missing` 里点名**：
    # 一只股占账户 1.5%，为它把整张 90 天日历抹空不成比例。
    stock_days = (stock_daily or {}).get("days") or {}

    today = now.astimezone(timezone.utc).date()
    out = []
    for back in range(days - 1, -1, -1):
        day = (today - timedelta(days=back)).isoformat()
        spot = spot_days.get(day)
        settle = settled.get(day)
        earn = earn_days.get(day) or 0.0
        interest = interest_days.get(day) or 0.0
        stock = stock_days.get(day) or 0.0
        total = None if spot is None else spot + (settle or 0.0) + earn + interest + stock
        out.append({
            "date": day,
            "spot_usd": spot,
            "stock_usd": stock,
            "settled_usd": settle or 0.0,
            "earn_usd": earn,
            "interest_usd": interest,
            "pnl_usd": total,
            # 这天算不算得出来。算不出来时 pnl_usd 是 null，不是"亏了 0"
            "known": total is not None,
        })
    return out


def _pnl(spot_daily: dict, futures: dict | None, income: dict | None,
         daily: list[dict], today_settled: dict | None = None,
         credits: dict[str, dict] | None = None,
         stock_daily: dict | None = None,
         equity_symbols: list[str] | None = None) -> dict | None:
    """盈亏构成。**每一项都有出处，没有残差项。**

    原先这里是"期末 − 期初 − 净充提"，剩下的靠残差反解未实现变动。那条路在
    Binance 上走不通：日快照只有三个钱包，理财 / 资金 / 币本位没有历史快照，
    "全部钱包的期初"取不到；而只覆盖三个钱包的话，**钱包之间的划转会被算成盈亏**。
    残差又会把这类口径错误照单全收，瀑布照样闭合——错了很久没人看得出来。

        每天   = 持仓涨跌（含当天成交那部分）+ 当天结算 + 派息 − 利息，见 `dailypnl.py`
        今天   = 上面那条的最后一格
        持仓   = 现货类的币**与正股**。正股的昨收不在 Binance 上（它的股票接口只有
                 买一卖一），从仓库已有的 Yahoo 日线取，`equity_close_source` 标明
        未实现 = **只有合约**：positionRisk 的 unRealizedProfit
        已实现 = **只有合约**：income 的 REALIZED_PNL
        其他   = 资金费 + 手续费 + 返佣

    **现货这一侧没有"相对成本"的任何数**——未实现没有，已实现也没有。两者都要
    完整的买入历史：划转 / 派息 / 小额兑换进来的币在 `myTrades` 里没有痕迹，
    90 天以前的充值也查不回来。卖得比重放看到的还多时能被识破（那个币会被标成
    成本不明），可**买得比看到的多、卖得不多时无声出错**——报一个看不出错的数
    比不报更糟。现货要看的是每天涨跌了多少，那只需要当天的持仓量与当天的收盘价，
    不需要任何成本。合约那半边不一样：`unRealizedProfit` 与 `REALIZED_PNL` 都是
    交易所按自己的开仓均价算好给的，拿来即用。

    窗口不一样，是接口的硬限，不是选择：逐日盈亏与 `income` 都只有 90 天，
    而合约未实现是**此刻**的值、没有窗口。所以界面上必须分开写。
    """
    fut_unreal = (futures or {}).get("total_unrealized_pnl")
    fut_real = (income or {}).get("realized_pnl")
    last = daily[-1] if daily else None

    if futures is None and income is None and not spot_daily.get("days"):
        return None
    return {
        # 今天赚了多少 = 日历最后一格。**同一个数只算一处**——上一版今天与日历
        # 各算各的，屏幕上两个数对不上。
        "today": {
            "spot_usd": last["spot_usd"] if last else None,
            "settled_usd": last["settled_usd"] if last else None,
            # 当天结算按类型拆开，见 `_today_settled`。各项之和 == settled_usd
            "settled_parts": today_settled,
            "stock_usd": last["stock_usd"] if last else None,
            "earn_usd": last["earn_usd"] if last else None,
            "interest_usd": last["interest_usd"] if last else None,
            "total_usd": last["pnl_usd"] if last else None,
        },
        "today_usd": last["pnl_usd"] if last else None,
        "unrealized": {
            "futures_usd": fut_unreal,
            "scope": "此刻的合约持仓",
        },
        "realized": {
            "futures_usd": fut_real,
            "futures_scope": f"最近 {WINDOW_DAYS} 天（接口只保留 90 天）",
        },
        "carry": {
            "funding_usd": (income or {}).get("funding_fee"),
            "commission_usd": (income or {}).get("commission"),
            "referral_usd": (income or {}).get("referral_kickback"),
            "scope": f"最近 {WINDOW_DAYS} 天",
        },
        "daily": daily,
        # 逐币的今日涨跌。数量跨全部钱包（含资金钱包），划进合约当保证金的也算在里面；
        # 正股也在这张表里，它的价格另有出处，见 `equity_close_source`。
        "spot_marks": spot_daily.get("today_by_asset", []),
        # 今天的派息与利息，按资产拆开。稳定币也在里面——它们不参与盯市，
        # 利息却是实打实的收入，原先整个丢了。
        "earn_marks": ((credits or {}).get("earn") or {}).get("today_by_asset", []),
        "interest_marks": ((credits or {}).get("interest") or {}).get("today_by_asset", []),
        # 正股逐只的今日涨跌，与上面那张表同一个形状、同一套算法，只是行情另有出处。
        "stock_marks": (stock_daily or {}).get("today_by_asset", []),
        # 拿不到昨收、因而没计进去的股票代码。**页面上要点名**，不能让人以为算全了。
        # 只点名现在还持有的：窗口里卖光的那些没有昨收也不影响今天。
        "equity_missing": sorted(set((stock_daily or {}).get("unpriced_assets", []))
                                 & set(equity_symbols or [])),
        # 资产页上只有这一项不来自 Binance：它的股票接口没有任何日线或前收。
        "equity_close_source": "Yahoo 日线复权收盘",
        # 持仓量回滚不平的币：有一类进出没被覆盖到（多半是 90 天以外的充值）。
        # 受影响的天已经报成 null，这里把是哪几个币说出来，便于查。
        "unbalanced_assets": spot_daily.get("unbalanced_assets", []),
    }


def build_portfolio(client: BinanceClient, cache: SourceCache, *,
                    force: bool = False, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    results = fetch_all(cache, _jobs(client, now), force=force, never_force=NEVER_FORCE)

    account_result = results["account.info"]

    def unavailable(key: str, detail: str) -> SourceResult:
        return SourceResult(key, None, "unsupported", account_result.as_of, detail)

    def dependent(key: str) -> SourceResult:
        return SourceResult(
            key, None, account_result.status, account_result.as_of,
            "账户能力信息不可用，未请求依赖接口。" +
            (f" {account_result.detail}" if account_result.detail else ""),
        )

    # 先读账户能力，再决定是否请求杠杆与统一账户端点。没有开通的产品直接标成
    # unsupported，既不制造一串 4xx，也不会让前端把“未启用”误报成数据源故障。
    if account_result.ok and isinstance(account_result.payload, dict):
        margin_enabled = bool(account_result.payload.get("isMarginEnabled", False))
        portfolio_enabled = bool(
            account_result.payload.get("isPortfolioMarginRetailEnabled", False))
        if margin_enabled:
            results.update(fetch_all(cache, [
                ("margin", TTL["margin"], client.margin_account),
                ("isolated_margin", TTL["margin"], client.isolated_margin_account),
                ("liquidation_loan", TTL["margin"], client.margin_liquidation_loan),
            ], force=force, never_force=NEVER_FORCE))
        else:
            detail = "账户未启用杠杆交易，未请求该接口。"
            results["margin"] = unavailable("margin", detail)
            results["isolated_margin"] = unavailable("isolated_margin", detail)
            results["liquidation_loan"] = unavailable("liquidation_loan", detail)

        if portfolio_enabled:
            probe = fetch_all(cache, [
                ("portfolio_margin.probe", TTL["account"],
                 client.portfolio_margin_pro_account),
            ], force=force, never_force=NEVER_FORCE)
            results.update(probe)
            probe_result = probe["portfolio_margin.probe"]
            account_type = ""
            if probe_result.ok and isinstance(probe_result.payload, dict):
                account_type = str(probe_result.payload.get("accountType", "")).upper()

            if not probe_result.ok:
                results["portfolio_margin"] = SourceResult(
                    "portfolio_margin", None, probe_result.status,
                    probe_result.as_of, probe_result.detail)
            elif account_type == "PM_3":
                mode_results = fetch_all(cache, [
                    ("portfolio_margin.summary", TTL["margin"],
                     lambda: client.portfolio_margin_pro_account(span=True)),
                    ("portfolio_margin.balance", TTL["margin"],
                     client.portfolio_margin_pro_balance),
                ], force=force, never_force=NEVER_FORCE)
                results.update(mode_results)
                failed = next((row for row in mode_results.values() if not row.ok), None)
                if failed:
                    results["portfolio_margin"] = SourceResult(
                        "portfolio_margin", None, failed.status, failed.as_of, failed.detail)
                else:
                    as_of = min(row.as_of for row in mode_results.values() if row.as_of)
                    results["portfolio_margin"] = SourceResult(
                        "portfolio_margin", {"accountType": account_type}, "ok", as_of, None)
            elif account_type in {"PM_1", "PM_2"}:
                mode_results = fetch_all(cache, [
                    ("portfolio_margin.summary", TTL["margin"],
                     client.portfolio_margin_account),
                    ("portfolio_margin.um_account", TTL["margin"],
                     client.portfolio_margin_um_account),
                    ("portfolio_margin.um_risk", TTL["margin"],
                     client.portfolio_margin_um_position_risk),
                ], force=force, never_force=NEVER_FORCE)
                results.update(mode_results)
                failed = next((row for row in mode_results.values() if not row.ok), None)
                if failed:
                    results["portfolio_margin"] = SourceResult(
                        "portfolio_margin", None, failed.status, failed.as_of, failed.detail)
                else:
                    as_of = min(row.as_of for row in mode_results.values() if row.as_of)
                    results["portfolio_margin"] = SourceResult(
                        "portfolio_margin", {"accountType": account_type}, "ok", as_of, None)
            else:
                results["portfolio_margin"] = unavailable(
                    "portfolio_margin",
                    f"统一账户返回未知账户类型：{account_type or '空值'}。")
        else:
            results["portfolio_margin"] = unavailable(
                "portfolio_margin", "账户未启用统一账户，未请求该接口。")
    else:
        # 能力探测失败时仍保留原先的全仓杠杆请求，让旧缓存可以继续降级显示；
        # 新增的高权重/模式相关接口则不盲目探测，并继承真实失败状态。
        results.update(fetch_all(cache, [
            ("margin", TTL["margin"], client.margin_account),
        ], force=force, never_force=NEVER_FORCE))
        results["isolated_margin"] = dependent("isolated_margin")
        results["liquidation_loan"] = dependent("liquidation_loan")
        results["portfolio_margin"] = dependent("portfolio_margin")

    def payload(key: str) -> Any:
        got = results.get(key)
        return got.payload if got else None

    # 每一块单独装配。**装配失败只降级这一块**——缓存层兜得住网络错误，
    # 但字段解析在它外面，Binance 改一次字段类型就会把整页 500 掉。
    errors: dict[str, str] = {}

    def block(key: str, fn, fallback=None):
        value, error = guard(key, fn, fallback=fallback)
        if error:
            errors[key] = error
        return value

    prices = block("prices", lambda: price_map(payload("prices")), fallback={}) or {}
    btc_usd = prices.get("BTCUSDT")

    wallets = block("wallets", lambda: _wallets(payload("wallets"), btc_usd), fallback=[]) or []
    spot = block("spot", lambda: _spot(payload("spot"), prices), fallback=[]) or []
    futures = block("futures", lambda: _futures(
        payload("futures.account"), payload("futures.config"),
        payload("futures.risk"), payload("futures.adl"),
        payload("futures.brackets"), payload("futures.exchange_info"),
        payload("futures.schedule"), payload("futures.symbol_adl"), prices, now,
        symbol_config=payload("futures.symbol_config")))
    stock_fallback = {
            "standalone_positions_available": False,
            "coverage_detail": STOCKS_COVERAGE,
            "equity_holdings": [],
            "tokenized_assets": [],
            "positions": [],
            "cost_coverage": {"manual": 0, "stale": 0, "total": 0},
        }
    stock_seed = block("stocks", lambda: _stocks(
        payload("wallets"), payload("equity.tokenized"), btc_usd), fallback=stock_fallback)
    stock_symbols = [row["symbol"] for row in stock_seed["positions"]]
    quote_results: dict[str, SourceResult] = {}
    if stock_symbols:
        quote_results = fetch_all(cache, _stock_quote_jobs(client, stock_symbols),
                                  force=force, never_force=NEVER_FORCE)
        results.update(quote_results)
    manual_costs = cache.stock_costs()
    stocks = block("stocks", lambda: _stocks(
        payload("wallets"), payload("equity.tokenized"), btc_usd,
        manual_costs,
        _fresh_payload(results, "equity.exchange_info"),
        {symbol: (quote_results[f"equity.quote.{symbol}"].payload
                  if quote_results.get(f"equity.quote.{symbol}")
                  and quote_results[f"equity.quote.{symbol}"].ok else None)
         for symbol in stock_symbols}), fallback=stock_fallback)
    capabilities = block("account", lambda: _capabilities(
        payload("account.info"), payload("account.restrictions")))
    earn = block("earn", lambda: _earn(payload("earn.flexible"),
                                       payload("earn.locked"), prices), fallback=[]) or []
    bfusd_rate = block("bfusd", lambda: _bfusd_rate(payload("bfusd.rate")))
    margin = block("margin", lambda: _margin(payload("margin"), btc_usd, prices))
    isolated_margin = block("isolated_margin", lambda: _isolated_margin(
        payload("isolated_margin"), btc_usd, prices))
    liquidation_loan = block("liquidation_loan", lambda: _liquidation_loan(
        payload("liquidation_loan")))
    probe_payload = payload("portfolio_margin.probe")
    account_type = str(probe_payload.get("accountType", "")) \
        if isinstance(probe_payload, dict) else ""
    portfolio_margin = block("portfolio_margin", lambda: _portfolio_margin(
        payload("portfolio_margin.summary"),
        payload("portfolio_margin.um_account") or payload("portfolio_margin.balance"),
        payload("portfolio_margin.um_risk"), account_type))
    income = block("income", lambda: _income(payload("income"), prices))
    transfers = block("transfers", lambda: _transfers(
        payload("transfers.deposits"), payload("transfers.withdrawals"), prices))
    # --- 第二阶段：按交易对取的东西 ----------------------------------------
    # `myTrades` 与 `klines` 的 symbol 都必填，而"持有哪些币"要先看余额——余额本身
    # 是第一阶段的来源，所以只能分两轮。第二轮很小，多一次往返换一个不靠残差的
    # 盈亏数，值得。
    # 资金钱包与正股都在这里并进来：前者原先整个漏掉，后者按股票代码计量。
    equity_holdings = stocks["equity_holdings"]
    held = held_across_wallets(spot, futures, margin, earn,
                               funding=_funding_balances(payload("wallets")))
    cost_symbols = _cost_symbols(held, prices)
    equity_symbols = sorted({row["symbol"] for row in equity_holdings if row.get("symbol")})
    trade_results: dict[str, SourceResult] = {}
    closes: dict[str, dict[str, float]] = {}
    equity_closes: dict[str, dict[str, float]] = {}
    if cost_symbols or equity_symbols:
        trade_results = fetch_all(cache,
                                  _trade_jobs(client, cost_symbols)
                                  + _close_jobs(client, cost_symbols)
                                  + _equity_close_jobs(equity_symbols),
                                  force=False, never_force=NEVER_FORCE)
        results.update(trade_results)
        closes = _closes(trade_results, cost_symbols)
        equity_closes = _equity_closes(trade_results, equity_symbols,
                                       days=WINDOW_DAYS, now=now)

    def all_trades() -> list[dict]:
        rows = []
        for sym in cost_symbols:
            got = trade_results.get(f"trades.{sym}")
            if got is not None and got.ok:
                rows.extend({**row, "symbol": sym} for row in got.payload or [])
        return rows

    # 逐日现货盈亏。**这是日历那一格的来源**，也是今天那一格。
    # 口径与回滚方式见 dailypnl.py——一句话：按当天的持仓量与当天的收盘价算，
    # 历史持仓量从今天的余额往回滚（跨钱包统计，划转自动相抵）。
    flows = block("spot_daily", lambda: collect_flows(
        trades=all_trades(),
        deposits=payload("transfers.deposits"),
        withdrawals=payload("transfers.withdrawals"),
        income=payload("income"),
        earn_flexible=payload("flows.earn_flexible"),
        earn_locked=payload("flows.earn_locked"),
        margin_interest=payload("flows.interest"),
        convert=payload("flows.convert"),
        dust=payload("flows.dust"),
        equity_trades=payload("flows.equity_trades")), fallback=[]) or []
    spot_daily = block("spot_daily", lambda: daily_spot_pnl(
        held, closes, flows, days=WINDOW_DAYS, now=now),
        fallback=_NO_DAILY) or _NO_DAILY
    # 正股**另走一遍同一套盯市**：同样是"持仓量 ×（今收 − 昨收）"，只是行情另有出处。
    # 不并进上面那一遍，是因为两边的降级不该互相牵连——Binance 的行情挂了，
    # 不该让股票那一行顶上去冒充"今天赚了多少"；Yahoo 挂了，也不该把整张日历抹空。
    stock_held = {row["symbol"]: row["qty"] for row in equity_holdings if row.get("symbol")}
    stock_daily = block("stock_daily", lambda: daily_spot_pnl(
        stock_held, equity_closes, flows, days=WINDOW_DAYS, now=now),
        fallback=_NO_DAILY) or _NO_DAILY if stock_held else _NO_DAILY
    # 理财派息与杠杆利息各自成项：它们不是涨跌，而且稳定币不参与盯市，
    # 放在盯市里等于把 USDT 活期的利息整个丢掉。见 `dailypnl.daily_credits`。
    credits = {kind: block("spot_daily", lambda k=kind: daily_credits(
        flows, closes, kind=k, days=WINDOW_DAYS, now=now), fallback=_NO_CREDITS)
        or _NO_CREDITS for kind in ("earn", "interest")}

    # 净值以钱包分布为准：它是 Binance 自己给的、跨全部钱包的合计，
    # 比把各块自己加起来更不容易漏（漏一个钱包就少一块钱）。
    usable = [w["value_usd"] for w in wallets if w["activate"] and w["value_usd"] is not None]
    equity = sum(usable) if usable else None

    notional = sum(p["notional_usd"] for p in (futures or {}).get("positions", []))
    totals = None if equity is None else {
        "equity_usd": equity,
        "gross_exposure_ratio": (notional / equity) if (equity and futures) else None,
    }

    states = _states(results, errors)

    # 页面时刻 = **会变的那些来源里最旧的一个**。取最旧而不是最新，是因为报最新的
    # 会让整页显得比实际新鲜；只算 live 那一组，是因为日频数据的年龄不该拖垮整页。
    live_states = [s for s in states if s["key"] in LIVE_CADENCE and s["status"] == "ok"]
    fresh = [datetime.fromisoformat(s["as_of"]) for s in live_states if s["as_of"]]
    if not fresh:
        # 会变的那些一个都没成功：退回全部成功来源，至少说出"这页上的东西有多旧"
        fresh = [r.as_of for r in results.values() if r.ok and r.as_of]
    return {
        "as_of": min(fresh).isoformat() if fresh else None,
        "base_currency": "USD",
        "sources": states,
        "totals": totals,
        # **"哪些资产算现金"由后端说了算，前端不再自己维护一份名单。**
        # 这件事原先在四个地方各写了一份、四份还不一样；少一个的后果见
        # `common.STABLE_ASSETS` 的注释。排序只为让响应稳定、好 diff。
        "stable_assets": sorted(STABLE_ASSETS),
        "yield_rates": {"BFUSD": bfusd_rate},
        "wallets": wallets,
        "spot": spot,
        "spot_costs": {
            asset: {
                "asset": asset,
                "cost_price_usd": float(row["cost_price_usd"]),
                "commission_usd": float(row["commission_usd"]),
                "position_qty": float(row["position_qty"]),
                "updated_at": row["updated_at"].isoformat(),
            }
            for asset, row in cache.spot_costs().items()
            if asset not in STABLE_ASSETS
        },
        "stocks": stocks,
        "capabilities": capabilities,
        "futures": futures,
        "earn": earn,
        "margin": margin,
        "isolated_margin": isolated_margin,
        "liquidation_loan": liquidation_loan,
        "portfolio_margin": portfolio_margin,
        "income": income,
        "transfers": transfers,
        "pnl": block("pnl", lambda: _pnl(
            spot_daily, futures, income,
            _daily(payload("income"), spot_daily.get("days", {}), prices,
                   WINDOW_DAYS, now, credits=credits, stock_daily=stock_daily),
            _today_settled(payload("income"), prices, now),
            credits=credits, stock_daily=stock_daily,
            equity_symbols=equity_symbols)),
    }
