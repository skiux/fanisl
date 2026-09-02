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

from datetime import datetime, timezone
from typing import Any, Callable

from .cache import SourceCache, SourceResult, fetch_all
from .client import BinanceClient
from .common import (
    WALLET_KIND, dec, dec0, guard, ms_to_iso, price_map, usd_price, usd_value,
)

WINDOW_DAYS = 30
MS_DAY = 86_400_000

# 每个来源的缓存时长。Binance 的 IP 权重上限 6000/分钟，这些数字是照着权重定的：
#   snapshots 单次权重 2400（三种类型就是 7200，已经超一分钟预算），但它是**日频**数据，
#   缓存 6 小时完全不损失信息。
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
# 页面顶上那个「截至 X」说的是**这些数字有多新**，而 snapshots（日快照）是
# **日频数据，长缓存是有意的**（单次权重 2400，三种类型就超一分钟预算）。把它们算进页面时刻，整页会被拖成"已过期"，还挂上一句
# "下面全部数字来自 X 的快照，不是当前余额"——而余额其实是 60 秒内的，那句话是假的。
#
# 它们各自的真实年龄没有被藏起来：每个来源自己的 as_of 照常返回，
# 界面上的「取数状态」一格一格地显示。
LIVE_CADENCE = frozenset({"prices", "wallets", "spot", "futures", "earn", "margin",
                          "income", "transfers"})

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
    "snapshots": ("snapshots.spot", ("snapshots.margin", "snapshots.futures",
                                     "snapshots.btc")),
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


def _futures(account: Any, config: Any, risk: Any, adl: Any) -> dict | None:
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


def _income(rows: Any, since_ms: int | None = None) -> dict | None:
    """`since_ms` 用来把损益裁到与净值曲线同一个窗口。

    取数时按固定 30 天拉，但曲线的实际长度取决于 accountSnapshot 有多少天
    （账户不满 30 天、或中间缺日都会变短）。归因表两边的窗口必须一致，
    否则多出来的那几天损益会被残差项吸走，表面上照样闭合。
    """
    if not isinstance(rows, list):
        return None
    out = {"realized_pnl": 0.0, "funding_fee": 0.0, "commission": 0.0,
           "insurance_clear": 0.0, "referral_kickback": 0.0, "other": 0.0}
    for row in rows:
        if since_ms is not None:
            try:
                if int(row.get("time", 0)) < since_ms:
                    continue
            except (TypeError, ValueError):
                continue
        field = _INCOME_FIELD.get(row.get("incomeType", ""), "other")
        # TRANSFER 是划转，不是损益，绝不能进这里——它会把真实盈亏算错
        if row.get("incomeType") in ("TRANSFER", "INTERNAL_TRANSFER"):
            continue
        out[field] += dec0(row.get("income"))
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


# 日快照只覆盖这三个钱包（accountSnapshot 的 type 就只有这三种）。期初与期末
# 必须量同一批钱包，否则理财/资金/币本位里的余额会被整个算成"这段时间赚的"。
_SNAPSHOT_WALLETS = frozenset({"spot", "cross_margin", "usdm_futures"})


def _comparable_equity(wallets: list[dict]) -> float | None:
    """与日快照同口径的期末净值：只取快照覆盖的那三个钱包。"""
    values = [w["value_usd"] for w in wallets
              if w["kind"] in _SNAPSHOT_WALLETS and w["value_usd"] is not None]
    return sum(values) if values else None


def _window_start(curve: list[dict]) -> int | None:
    """曲线第一天 00:00 UTC 的毫秒时间戳。归因表的窗口以它为准。"""
    return _day_start_ms(curve[0]["date"]) if curve else None


def _day_start_ms(day: str) -> int | None:
    """"2026-08-04" → 当天 00:00 UTC 的毫秒时间戳。日快照就是按 UTC 日切的。"""
    try:
        dt = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return int(dt.timestamp() * 1000)


def _attribution(curve: list[dict], wallets: list[dict], transfers: dict | None,
                 income: dict | None) -> dict | None:
    """恒等式：期末 = 期初 + 净充提 + 已实现 + 未实现变动 + 资金费 + 手续费。

    缺任何一项都不闭合。与其给一张对不上账的表，不如整块留空——这是契约里写死的口径。

    两条曾经错得很隐蔽的地方：

    - **期末原先用的是全部钱包的合计**（`totals.equity_usd`），期初却来自日快照，
      而快照只有现货 / 全仓杠杆 / U 本位合约三种。于是理财、资金、币本位、期权里的
      余额被整个当成利润。这里改成同口径的三个钱包。
    - **窗口原先写死 30 天**。accountSnapshot 只保留最近 30 天，账户没满 30 天、
      或中间有缺日，曲线就短一截，而标题照旧写"30 天"。现在报实际天数与起始日期。

    残差项照旧反解未实现变动，瀑布因此总是闭合——**这正是上面两个错误一直没被发现的
    原因**：残差会把任何口径错误照单全收。所以口径本身必须是对的，闭合不构成证据。
    """
    closing = _comparable_equity(wallets)
    if not curve or closing is None or transfers is None or income is None:
        return None
    opening = curve[0]["equity_usd"]
    net_transfer = transfers["net_usd"]
    realized = income["realized_pnl"] + income["referral_kickback"] + income["insurance_clear"]
    funding, commission = income["funding_fee"], income["commission"]
    true_pnl = closing - opening - net_transfer
    unrealized = true_pnl - realized - funding - commission
    average_capital = opening + net_transfer / 2
    return {
        "window_days": len(curve),
        "window_start": curve[0]["date"],
        "opening_equity": opening, "closing_equity": closing,
        "net_transfer": net_transfer, "realized_pnl": realized,
        "unrealized_delta": unrealized, "funding_fee": funding, "commission": commission,
        "true_pnl": true_pnl,
        "true_return": (true_pnl / average_capital) if average_capital > 0 else None,
    }


# 贵到不该被"重新取数"穿透的来源。日快照单次权重 2400，三种类型 7200，
# 已经超过一分钟 6000 的预算；而它本身是日频数据，强刷没有意义。
NEVER_FORCE = frozenset({"snapshots.spot", "snapshots.margin", "snapshots.futures",
                         "snapshots.btc"})


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
        payload("futures.risk"), payload("futures.adl")))
    earn = block("earn", lambda: _earn(payload("earn.flexible"),
                                       payload("earn.locked"), prices), fallback=[]) or []
    margin = block("margin", lambda: _margin(payload("margin"), btc_usd))
    income = block("income", lambda: _income(payload("income")))
    transfers = block("transfers", lambda: _transfers(
        payload("transfers.deposits"), payload("transfers.withdrawals"), prices))
    curve, curve_detail = block("snapshots", lambda: _equity_curve(
        payload("snapshots.spot"), payload("snapshots.margin"),
        payload("snapshots.futures"), payload("snapshots.btc")),
        fallback=([], None)) or ([], None)

    # 净值以钱包分布为准：它是 Binance 自己给的、跨全部钱包的合计，
    # 比把各块自己加起来更不容易漏（漏一个钱包就少一块钱）。
    usable = [w["value_usd"] for w in wallets if w["activate"] and w["value_usd"] is not None]
    equity = sum(usable) if usable else None

    notional = sum(p["notional_usd"] for p in (futures or {}).get("positions", []))
    change_24h = change_24h_pct = None
    # 与曲线比大小必须用同口径的净值：曲线来自日快照（只有三个钱包），
    # 拿全部钱包的合计去减昨天的快照，理财与资金里的余额每天都会被算成"今日变动"。
    comparable = _comparable_equity(wallets)
    if comparable is not None and len(curve) >= 2:
        yesterday = curve[-2]["equity_usd"]
        change_24h = comparable - yesterday
        change_24h_pct = (change_24h / yesterday) if yesterday else None

    totals = None if equity is None else {
        "equity_usd": equity,
        "gross_exposure_ratio": (notional / equity) if (equity and futures) else None,
        "change_24h_usd": change_24h,
        "change_24h_pct": change_24h_pct,
    }

    states = _states(results, errors)
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
        "attribution": block("attribution", lambda: _attribution(
            curve, wallets,
            _transfers(payload("transfers.deposits"), payload("transfers.withdrawals"),
                       prices, _window_start(curve)),
            _income(payload("income"), _window_start(curve)))),
    }
