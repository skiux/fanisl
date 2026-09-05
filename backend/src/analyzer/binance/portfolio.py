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

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .cache import SourceCache, SourceResult, fetch_all
from .client import BinanceClient
from .costbasis import (
    USD_QUOTES, held_across_wallets, replay, split_symbol, summarize,
)
from .dailypnl import collect_flows, daily_spot_pnl
from .common import (
    WALLET_KIND, dec, dec0, guard, ms_to_iso, price_map, usd_price, usd_value,
)

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


class _Missing:
    """`trade_results` 里没有这个键时的替身，省掉一处 `is None or not ok`。"""
    ok = False
    payload = None


_MISSING = _Missing()

_NO_DAILY = {"days": {}, "today_by_asset": [], "unknown_days": [],
             "unbalanced_assets": [], "unpriced_assets": []}


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
        if qty <= 0 or asset in USD_QUOTES:
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
        ("futures.risk", TTL["futures"], client.futures_position_risk),
        ("futures.adl", TTL["futures"], client.futures_adl_quantile),
        ("earn.flexible", TTL["earn"], client.earn_flexible_positions),
        ("earn.locked", TTL["earn"], client.earn_locked_positions),
        ("margin", TTL["margin"], client.margin_account),
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
LIVE_CADENCE = frozenset({"prices", "wallets", "spot", "futures", "earn", "margin",
                          "income", "transfers"})

# 贵到不该被"重新取数"穿透的来源。提现历史单次权重 18000（账户维度 10 次/秒），
# 是所有端点里最贵的；成交历史要按 id 翻页，页数随成交笔数增长，而它只增不改，
# 强刷没有意义。用户连点几下就能把权重预算打空，然后所有页面一起 429。
NEVER_FORCE = frozenset({"transfers.withdrawals"})

# 契约里的八个来源，各自由哪些子调用支撑。primary 决定状态，extra 只在失败时补一句说明。
_CONTRACT_SOURCES: dict[str, tuple[str, tuple[str, ...]]] = {
    "prices": ("prices", ()),
    "wallets": ("wallets", ()),
    "spot": ("spot", ()),
    "futures": ("futures.account", ("futures.config", "futures.risk", "futures.adl")),
    "earn": ("earn.flexible", ("earn.locked",)),
    "margin": ("margin", ()),
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
                missing = [k for k in extras if not results[k].ok]
                if missing:
                    state["detail"] = "部分补充数据取不到：" + "、".join(missing)
        out.append(state)
    return out


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


def _futures(account: Any, config: Any, risk: Any, adl: Any,
             prices: dict[str, float] | None = None) -> dict | None:
    if not isinstance(account, dict):
        return None

    # positionRisk 才有标记价与强平价；account 里只有保证金与未实现盈亏
    risk_by = {}
    for row in risk or []:
        risk_by[(row.get("symbol"), row.get("positionSide", "BOTH"))] = row
    adl_by = {r.get("symbol"): r.get("adlQuantile", {}) for r in adl or []}

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
        positions.append({
            "symbol": symbol,
            "position_side": {"BOTH": "both", "LONG": "long", "SHORT": "short"}.get(side, "both"),
            "position_amt": amt,
            "notional_usd": notional,
            "entry_price": dec0(row.get("entryPrice")),
            "mark_price": mark if mark is not None else dec0(row.get("entryPrice")),
            "liquidation_price": liq,
            "liq_distance": distance,
            "leverage": int(dec0(row.get("leverage")) or 1),
            "isolated": bool(row.get("isolated", False)),
            "unrealized_pnl_usd": dec0(row.get("unrealizedProfit")),
            "initial_margin_usd": dec0(row.get("positionInitialMargin")
                                       or row.get("initialMargin")),
            "maint_margin_usd": dec0(row.get("maintMargin")),
            "adl_quantile": int(adl_q) if adl_q is not None else None,
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


def _earn(flexible: Any, locked: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in (flexible or {}).get("rows", []) if isinstance(flexible, dict) else []:
        asset = row.get("asset", "")
        amount = dec0(row.get("totalAmount"))
        rewards = dec(row.get("cumulativeTotalRewards"))
        out.append({
            "product_id": row.get("productId", ""), "asset": asset, "amount": amount,
            "value_usd": usd_value(asset, amount, prices), "kind": "flexible",
            "apr": dec(row.get("latestAnnualPercentageRate")),
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
            "apr": dec(row.get("apy") or row.get("APY")),
            "cumulative_rewards": rewards,
            "cumulative_rewards_usd": usd_value(reward_asset, rewards, prices),
            "redeem_date": (ms_to_iso(row.get("deliverDate")) or "")[:10] or None,
            "can_redeem": bool(row.get("canRedeemEarly", False)),
        })
    out.sort(key=lambda r: r["value_usd"] if r["value_usd"] is not None else -1, reverse=True)
    return out


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
           prices: dict[str, float], days: int, now: datetime) -> list[dict]:
    """日历的每一格：**那天到底赚了多少**。

        一天 = 现货持仓的涨跌（含当天成交的那部分）+ 当天结算掉的

    "结算掉的"是合约那半边：已实现盈亏、资金费、手续费、返佣。它们是真金白银的
    进出，只报 REALIZED_PNL 会让"这天赚了多少"偏乐观。

    **现货那半边原来只算卖出结转，所以不成交的日子全是 0。** 那不是"这天没赚没亏"，
    是"这天没成交"——拿着 6 个 BNB 什么都不做，涨 10 块就是赚 60 块。现在按当天的
    持仓量与收盘价算，见 `dailypnl.py`。

    **现货已实现不在这里再加一遍**：卖出那笔的盈亏已经含在市值变化里
    （卖出当天的 `数量 × (收盘 − 成交价)` 那一项），加两次就是重复计。
    `costbasis` 的已实现回答的是另一个问题（相对**终身**均价赚了多少），
    只出现在盈亏构成里。

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
    today = now.astimezone(timezone.utc).date()
    out = []
    for back in range(days - 1, -1, -1):
        day = (today - timedelta(days=back)).isoformat()
        spot = spot_days.get(day)
        settle = settled.get(day)
        total = None if spot is None else spot + (settle or 0.0)
        out.append({
            "date": day,
            "spot_usd": spot,
            "settled_usd": settle or 0.0,
            "pnl_usd": total,
            # 这天算不算得出来。算不出来时 pnl_usd 是 null，不是"亏了 0"
            "known": total is not None,
        })
    return out


def _pnl(spot_cost: dict | None, spot_daily: dict, futures: dict | None,
         income: dict | None, daily: list[dict]) -> dict | None:
    """盈亏构成。**每一项都有出处，没有残差项。**

    原先这里是"期末 − 期初 − 净充提"，剩下的靠残差反解未实现变动。那条路在
    Binance 上走不通：日快照只有三个钱包，理财 / 资金 / 币本位没有历史快照，
    "全部钱包的期初"取不到；而只覆盖三个钱包的话，**钱包之间的划转会被算成盈亏**。
    残差又会把这类口径错误照单全收，瀑布照样闭合——错了很久没人看得出来。

        每天   = 现货持仓涨跌（含当天成交那部分）+ 当天结算，见 `dailypnl.py`
        今天   = 上面那条的最后一格
        未实现 = **只有合约**：positionRisk 的 unRealizedProfit
        已实现 = 现货卖出相对终身均价结转的 + 合约 REALIZED_PNL
        其他   = 资金费 + 手续费 + 返佣

    **现货没有"未实现"这一项。** 它是市值减加权平均成本，而那个成本要完整的买入
    历史，划转 / 派息 / 小额兑换进来的币在 `myTrades` 里没有痕迹，90 天以前的充值
    也查不回来——算出来永远缺一块。现货要看的是每天涨跌了多少，那只需要当天的
    持仓量与当天的收盘价，不需要任何成本。合约那半边不一样：`unRealizedProfit`
    是交易所按自己的开仓均价给的，拿来即用。

    窗口不一样，是接口的硬限，不是选择：
    - 现货成交 `myTrades` 用 fromId 翻页，**没有时间上限**，是全历史
    - 合约 `income` **只保留 90 天**，`userTrades` 同样只有 90 天
    - 合约未实现是**此刻**的值，没有窗口概念

    所以界面上必须分开写，不能加成一个数说"这段时间赚了多少"。
    """
    spot_real = (spot_cost or {}).get("realized_usd")
    fut_unreal = (futures or {}).get("total_unrealized_pnl")
    fut_real = (income or {}).get("realized_pnl")
    last = daily[-1] if daily else None

    if spot_cost is None and futures is None and income is None:
        return None
    return {
        # 今天赚了多少 = 日历最后一格。**同一个数只算一处**——上一版今天与日历
        # 各算各的，屏幕上两个数对不上。
        "today": {
            "spot_usd": last["spot_usd"] if last else None,
            "settled_usd": last["settled_usd"] if last else None,
            "total_usd": last["pnl_usd"] if last else None,
        },
        "today_usd": last["pnl_usd"] if last else None,
        "unrealized": {
            "futures_usd": fut_unreal,
            "scope": "此刻的合约持仓",
        },
        "realized": {
            "spot_usd": spot_real,
            "spot_scope": "全部成交历史",
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
        # 逐币的今日涨跌。数量跨全部钱包，划进合约当保证金的也算在里面。
        "spot_marks": spot_daily.get("today_by_asset", []),
        "spot_assets": (spot_cost or {}).get("assets", []),
        "coverage": (spot_cost or {}).get("coverage"),
        "incomplete_assets": (spot_cost or {}).get("incomplete_assets", []),
        "failed_symbols": (spot_cost or {}).get("failed_symbols", []),
        # 持仓量回滚不平的币：有一类进出没被覆盖到（多半是 90 天以外的充值）。
        # 受影响的天已经报成 null，这里把是哪几个币说出来，便于查。
        "unbalanced_assets": spot_daily.get("unbalanced_assets", []),
    }


def build_portfolio(client: BinanceClient, cache: SourceCache, *,
                    force: bool = False, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    results = fetch_all(cache, _jobs(client, now), force=force, never_force=NEVER_FORCE)

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
        payload("futures.risk"), payload("futures.adl"), prices))
    earn = block("earn", lambda: _earn(payload("earn.flexible"),
                                       payload("earn.locked"), prices), fallback=[]) or []
    margin = block("margin", lambda: _margin(payload("margin"), btc_usd, prices))
    income = block("income", lambda: _income(payload("income"), prices))
    transfers = block("transfers", lambda: _transfers(
        payload("transfers.deposits"), payload("transfers.withdrawals"), prices))
    # --- 第二阶段：按交易对取的东西 ----------------------------------------
    # `myTrades` 与 `klines` 的 symbol 都必填，而"持有哪些币"要先看余额——余额本身
    # 是第一阶段的来源，所以只能分两轮。第二轮很小，多一次往返换一个不靠残差的
    # 盈亏数，值得。
    held = held_across_wallets(spot, futures, margin, earn)
    cost_symbols = _cost_symbols(held, prices)
    trade_results: dict[str, SourceResult] = {}
    closes: dict[str, dict[str, float]] = {}
    if cost_symbols:
        trade_results = fetch_all(cache,
                                  _trade_jobs(client, cost_symbols)
                                  + _close_jobs(client, cost_symbols),
                                  force=False, never_force=NEVER_FORCE)
        results.update(trade_results)
        closes = _closes(trade_results, cost_symbols)

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
    spot_daily = block("spot_daily", lambda: daily_spot_pnl(
        held, closes,
        collect_flows(trades=all_trades(),
                      deposits=payload("transfers.deposits"),
                      withdrawals=payload("transfers.withdrawals"),
                      income=payload("income"),
                      earn_flexible=payload("flows.earn_flexible"),
                      earn_locked=payload("flows.earn_locked"),
                      margin_interest=payload("flows.interest"),
                      convert=payload("flows.convert"),
                      dust=payload("flows.dust")),
        days=WINDOW_DAYS, now=now), fallback=_NO_DAILY) or _NO_DAILY

    def cost_basis() -> dict | None:
        missing = [sym for sym in cost_symbols
                   if not (trade_results.get(f"trades.{sym}") or _MISSING).ok]
        if missing and len(missing) == len(cost_symbols):
            return None
        lots = replay(all_trades(),
                      deposits=payload("transfers.deposits") or [],
                      rewards=[])
        out = summarize(lots, {a: usd_price(a, prices) for a in held} | {"USDT": 1.0},
                        held=held)
        out["symbols"] = cost_symbols
        # 已经卖光的币查不到：它不在余额里，就没有线索指向它的交易对。
        # 说出来，别让人以为已实现是全的。
        out["coverage"] = "只覆盖当前还持有的币；已清仓的标的查不到交易对"
        out["failed_symbols"] = missing
        return out

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
        "wallets": wallets,
        "spot": spot,
        "futures": futures,
        "earn": earn,
        "margin": margin,
        "income": income,
        "transfers": transfers,
        "pnl": block("pnl", lambda: _pnl(
            block("cost_basis", cost_basis), spot_daily, futures, income,
            _daily(payload("income"), spot_daily.get("days", {}), prices,
                   WINDOW_DAYS, now))),
    }
