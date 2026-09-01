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
from .common import (
    WALLET_KIND, base_of, dec, dec0, ms_to_iso, price_map, usd_price, usd_value,
)

WINDOW_DAYS = 30
MS_DAY = 86_400_000

# 每个来源的缓存时长。Binance 的 IP 权重上限 6000/分钟，这些数字是照着权重定的：
#   snapshots 单次权重 2400（三种类型就是 7200，已经超一分钟预算），但它是**日频**数据，
#   缓存 6 小时完全不损失信息；brackets 几乎不变，一天一次足够。
TTL = {
    "prices": 30,
    "wallets": 60,
    "spot": 60,
    "futures": 30,
    "brackets": 86_400,
    "earn": 300,
    "margin": 60,
    "income": 300,
    "transfers": 300,
    # 提现历史单次权重 **18000**（账户维度，10 次/秒），是所有端点里最贵的一个。
    # 30 天窗口的充提合计在 5 分钟里不会有意义地变化，单独放长到 15 分钟，
    # 与流水页对齐。充值那半边权重只有 1，照旧 300 秒。
    "withdrawals": 900,
    "snapshots": 21_600,
}


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
        ("brackets", TTL["brackets"], client.leverage_brackets),
        ("earn.flexible", TTL["earn"], client.earn_flexible_positions),
        ("earn.locked", TTL["earn"], client.earn_locked_positions),
        ("margin", TTL["margin"], client.margin_account),
        ("income", TTL["income"],
         lambda: client.futures_income(start_ms=start_ms, end_ms=end_ms)),
        ("transfers.deposits", TTL["transfers"],
         lambda: client.deposits(start_ms=start_ms, end_ms=end_ms)),
        ("transfers.withdrawals", TTL["withdrawals"],
         lambda: client.withdrawals(start_ms=start_ms, end_ms=end_ms)),
        ("snapshots.spot", TTL["snapshots"], lambda: client.account_snapshot("SPOT")),
        ("snapshots.margin", TTL["snapshots"], lambda: client.account_snapshot("MARGIN")),
        ("snapshots.futures", TTL["snapshots"], lambda: client.account_snapshot("FUTURES")),
        ("snapshots.btc", TTL["snapshots"],
         lambda: client.klines("BTCUSDT", "1d", WINDOW_DAYS + 2)),
    ]


# 哪些来源是"会变的"。
#
# 页面顶上那个「截至 X」说的是**这些数字有多新**，而 brackets（杠杆档位，几乎不变）
# 与 snapshots（日快照）是**日频数据，长缓存是有意的**（后者单次权重 2400，三种类型
# 就超一分钟预算）。把它们算进页面时刻，整页会被拖成"已过期"，还挂上一句
# "下面全部数字来自 X 的快照，不是当前余额"——而余额其实是 60 秒内的，那句话是假的。
#
# 它们各自的真实年龄没有被藏起来：每个来源自己的 as_of 照常返回，
# 界面上的「取数状态」一格一格地显示。
LIVE_CADENCE = frozenset({"prices", "wallets", "spot", "futures", "earn", "margin",
                          "income", "transfers"})

# 契约里的九个来源，各自由哪些子调用支撑。primary 决定状态，extra 只在失败时补一句说明。
_CONTRACT_SOURCES: dict[str, tuple[str, tuple[str, ...]]] = {
    "prices": ("prices", ()),
    "wallets": ("wallets", ()),
    "spot": ("spot", ()),
    "futures": ("futures.account", ("futures.config", "futures.risk", "futures.adl")),
    "brackets": ("brackets", ()),
    "earn": ("earn.flexible", ("earn.locked",)),
    "margin": ("margin", ()),
    "income": ("income", ()),
    "transfers": ("transfers.deposits", ("transfers.withdrawals",)),
    "snapshots": ("snapshots.spot", ("snapshots.margin", "snapshots.futures",
                                     "snapshots.btc")),
}


def _states(results: dict[str, SourceResult]) -> list[dict]:
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
             brackets: Any) -> dict | None:
    if not isinstance(account, dict):
        return None

    # positionRisk 才有标记价与强平价；account 里只有保证金与未实现盈亏
    risk_by = {}
    for row in risk or []:
        risk_by[(row.get("symbol"), row.get("positionSide", "BOTH"))] = row
    adl_by = {r.get("symbol"): r.get("adlQuantile", {}) for r in adl or []}
    # leverageBracket 的维持保证金率：positionRisk 给不出强平价时（全仓且余额充足）
    # 用它兜底算"距强平"，仍算不出就留 null，不猜
    maint_rate = {}
    for row in brackets or []:
        tiers = row.get("brackets") or []
        if tiers:
            maint_rate[row.get("symbol")] = dec(tiers[0].get("maintMarginRatio"))

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
        distance = None
        if liq is not None and mark:
            distance = abs(mark - liq) / mark
        elif maint_rate.get(symbol) is not None and mark:
            # 近似：距强平 ≈ 1/杠杆 − 维持保证金率
            lev = dec(row.get("leverage")) or 1.0
            approx = 1.0 / lev - (maint_rate[symbol] or 0.0)
            distance = approx if approx > 0 else None
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


def _margin(payload: Any, btc_usd: float | None) -> dict | None:
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


def _income(rows: Any) -> dict | None:
    if not isinstance(rows, list):
        return None
    out = {"realized_pnl": 0.0, "funding_fee": 0.0, "commission": 0.0,
           "insurance_clear": 0.0, "referral_kickback": 0.0, "other": 0.0}
    for row in rows:
        field = _INCOME_FIELD.get(row.get("incomeType", ""), "other")
        # TRANSFER 是划转，不是损益，绝不能进这里——它会把真实盈亏算错
        if row.get("incomeType") in ("TRANSFER", "INTERNAL_TRANSFER"):
            continue
        out[field] += dec0(row.get("income"))
    return out


def _transfers(deposits: Any, withdrawals: Any, prices: dict[str, float]) -> dict | None:
    if not isinstance(deposits, list) or not isinstance(withdrawals, list):
        return None
    dep = wit = 0.0
    dep_n = wit_n = 0
    for row in deposits:
        if int(row.get("status", 0)) != 1:      # 只算已到账的
            continue
        value = usd_value(row.get("coin", ""), dec0(row.get("amount")), prices)
        dep += value or 0.0
        dep_n += 1
    for row in withdrawals:
        if int(row.get("status", 0)) != 6:      # 6 = Completed
            continue
        value = usd_value(row.get("coin", ""), dec0(row.get("amount")), prices)
        wit += value or 0.0
        wit_n += 1
    return {"deposits_usd": dep, "withdrawals_usd": wit, "net_usd": dep - wit,
            "deposit_count": dep_n, "withdrawal_count": wit_n}


def _btc_closes(klines: Any) -> dict[str, float]:
    """日线 → {YYYY-MM-DD: 收盘价}。"""
    out = {}
    for row in klines or []:
        try:
            day = datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc).date().isoformat()
            out[day] = float(row[4])
        except (TypeError, ValueError, IndexError):
            continue
    return out


def _snapshot_days(payload: Any, *, btc_denominated: bool) -> dict[str, float]:
    """accountSnapshot → {日期: 该账户当天的总额}。

    现货与杠杆的快照给 `totalAssetOfBtc`（BTC 计价）；合约那份没有这个字段，
    只有逐资产的 marginBalance（USDT 计价）。两者单位不同，调用方负责换算。
    """
    out: dict[str, float] = {}
    vos = (payload or {}).get("snapshotVos", []) if isinstance(payload, dict) else []
    for vo in vos:
        day = (ms_to_iso(vo.get("updateTime")) or "")[:10]
        if not day:
            continue
        data = vo.get("data") or {}
        if btc_denominated:
            out[day] = dec0(data.get("totalAssetOfBtc"))
        else:
            out[day] = sum(dec0(a.get("marginBalance")) for a in data.get("assets", []))
    return out


def _equity_curve(spot_snap: Any, margin_snap: Any, futures_snap: Any,
                  klines: Any) -> tuple[list[dict], str | None]:
    """日快照拼成净值曲线，并说明这条线包含了哪几块。"""
    closes = _btc_closes(klines)
    if not closes:
        return [], "缺 BTC 日线，BTC 计价的快照换不成 USD"

    spot_days = _snapshot_days(spot_snap, btc_denominated=True)
    margin_days = _snapshot_days(margin_snap, btc_denominated=True)
    futures_days = _snapshot_days(futures_snap, btc_denominated=False)

    included, missing = [], []
    for label, days in (("现货", spot_days), ("杠杆", margin_days), ("合约", futures_days)):
        (included if days else missing).append(label)
    if not included:
        return [], "三种日快照都没取到"

    out = []
    for day in sorted(set(spot_days) | set(margin_days) | set(futures_days)):
        btc_close = closes.get(day)
        if btc_close is None:
            continue
        # **用当天的 BTC 价**，不是今天的——否则画出来的是 BTC 的走势
        equity = (spot_days.get(day, 0.0) + margin_days.get(day, 0.0)) * btc_close
        equity += futures_days.get(day, 0.0)
        out.append({"date": day, "equity_usd": equity})

    detail = None if not missing else f"这条曲线只含{'、'.join(included)}，缺{'、'.join(missing)}"
    return out[-WINDOW_DAYS:], detail


def _attribution(curve: list[dict], closing: float | None, transfers: dict | None,
                 income: dict | None) -> dict | None:
    """恒等式：期末 = 期初 + 净充提 + 已实现 + 未实现变动 + 资金费 + 手续费。

    缺任何一项都不闭合。与其给一张对不上账的表，不如整块留空——这是契约里写死的口径。
    """
    if not curve or closing is None or transfers is None or income is None:
        return None
    opening = curve[0]["equity_usd"]
    net_transfer = transfers["net_usd"]
    realized = income["realized_pnl"] + income["referral_kickback"] + income["insurance_clear"]
    funding, commission = income["funding_fee"], income["commission"]
    true_pnl = closing - opening - net_transfer
    # 未实现变动由残差反解，瀑布图因此永远闭合
    unrealized = true_pnl - realized - funding - commission
    average_capital = opening + net_transfer / 2
    return {
        "window_days": WINDOW_DAYS,
        "opening_equity": opening, "closing_equity": closing,
        "net_transfer": net_transfer, "realized_pnl": realized,
        "unrealized_delta": unrealized, "funding_fee": funding, "commission": commission,
        "true_pnl": true_pnl,
        "true_return": (true_pnl / average_capital) if average_capital > 0 else None,
    }


# 贵到不该被"重新取数"穿透的来源。日快照单次权重 2400，三种类型 7200，
# 已经超过一分钟 6000 的预算；而它本身是日频数据，强刷没有意义。
NEVER_FORCE = frozenset({"snapshots.spot", "snapshots.margin", "snapshots.futures",
                         "snapshots.btc", "brackets"})


def build_portfolio(client: BinanceClient, cache: SourceCache, *,
                    force: bool = False, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    results = fetch_all(cache, _jobs(client, now), force=force, never_force=NEVER_FORCE)

    def payload(key: str) -> Any:
        got = results.get(key)
        return got.payload if got else None

    prices = price_map(payload("prices"))
    btc_usd = prices.get("BTCUSDT")

    wallets = _wallets(payload("wallets"), btc_usd)
    spot = _spot(payload("spot"), prices)
    futures = _futures(payload("futures.account"), payload("futures.config"),
                       payload("futures.risk"), payload("futures.adl"),
                       payload("brackets"))
    earn = _earn(payload("earn.flexible"), payload("earn.locked"), prices)
    margin = _margin(payload("margin"), btc_usd)
    income = _income(payload("income"))
    transfers = _transfers(payload("transfers.deposits"),
                           payload("transfers.withdrawals"), prices)
    curve, curve_detail = _equity_curve(
        payload("snapshots.spot"), payload("snapshots.margin"),
        payload("snapshots.futures"), payload("snapshots.btc"))

    # 净值以钱包分布为准：它是 Binance 自己给的、跨全部钱包的合计，
    # 比把各块自己加起来更不容易漏（漏一个钱包就少一块钱）。
    usable = [w["value_usd"] for w in wallets if w["activate"] and w["value_usd"] is not None]
    equity = sum(usable) if usable else None

    notional = sum(p["notional_usd"] for p in (futures or {}).get("positions", []))
    change_24h = change_24h_pct = None
    if equity is not None and len(curve) >= 2:
        yesterday = curve[-2]["equity_usd"]
        change_24h = equity - yesterday
        change_24h_pct = (change_24h / yesterday) if yesterday else None

    totals = None if equity is None else {
        "equity_usd": equity,
        "gross_exposure_ratio": (notional / equity) if (equity and futures) else None,
        "change_24h_usd": change_24h,
        "change_24h_pct": change_24h_pct,
    }

    states = _states(results)
    if curve_detail:
        for state in states:
            if state["key"] == "snapshots" and state["status"] == "ok":
                state["detail"] = curve_detail

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
        "equity_curve": curve,
        "attribution": _attribution(curve, equity, transfers, income),
    }
