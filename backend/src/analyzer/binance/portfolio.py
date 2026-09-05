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
    USD_QUOTES, held_across_wallets, realized_by_day, replay, split_symbol, summarize,
)
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
    # 昨日收盘：一整个 UTC 日里是个定值，但**跨过零点就得换一根**。
    # 放太长的话，日切之后"今日盈亏"还在拿前天的收盘当基准。单次权重 2。
    "prev_close": 900,
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
    """昨日 UTC 收盘价，按交易对一个来源。公开端点、不签名、单次权重 2。

    `limit=2` 拿两根日线：最后一根是**今天这根**（还在走），前一根才是昨天收盘的。
    直接取最后一根的 close 等于拿现价当昨收，今日盈亏永远是 0。
    """
    return [(f"close.{sym}", TTL["prev_close"],
             (lambda s=sym: client.klines(s, interval="1d", limit=2))) for sym in symbols]


def _prev_closes(results: dict[str, SourceResult], symbols: list[str]) -> dict[str, float]:
    """`{资产: 昨日收盘价}`。取不到的币不出现在里面——留空比给一个错的基准好。"""
    out: dict[str, float] = {}
    for sym in symbols:
        got = results.get(f"close.{sym}")
        rows = got.payload if (got and got.ok) else None
        if not isinstance(rows, list) or len(rows) < 2:
            continue
        close = dec(rows[-2][4]) if len(rows[-2]) > 4 else None
        if close is not None and close > 0:
            base = split_symbol(sym)
            if base:
                out[base[0]] = close
    return out


def _spot_today(held: dict[str, float], prices: dict[str, float],
                prev: dict[str, float]) -> dict:
    """现货今天赚了多少：**持有量 ×（现价 − 昨收）**。

    **现货不按成本算未实现。** 那是相对买入价的终身数，要完整的买入历史——而
    划转 / 理财派息 / 小额兑换进来的币在 `myTrades` 里没有任何痕迹，那段历史补不齐
    （`capital/deposit/hisrec` 只回 90 天）。硬算的结果是一个永远缺一块的数，
    2026-09 为它修过三轮，还一度做成"让人手填均价"。

    盯市不需要历史：只要数量和两个价格。数量是**跨全部钱包**的（`held_across_wallets`），
    划进合约当保证金的那部分本来就在里面——所谓"现货数据缺失"其实只是币不在现货钱包，
    量一直都在。

    稳定币不参与：它的价格恒等于面值，算出来是噪声。
    """
    rows = []
    total = 0.0
    for asset in sorted(held):
        qty = held[asset]
        if qty <= 0 or asset in USD_QUOTES:
            continue
        now_price = usd_price(asset, prices)
        was = prev.get(asset)
        change = None if (now_price is None or was is None) else qty * (now_price - was)
        if change is not None:
            total += change
        rows.append({
            "asset": asset,
            "qty": qty,
            "price_usd": now_price,
            "prev_close_usd": was,
            "value_usd": None if now_price is None else qty * now_price,
            "today_usd": change,
        })
    # 一个币都算不出来时别报 0——"今天没涨没跌"与"取不到昨收"是两件事
    known = [r for r in rows if r["today_usd"] is not None]
    return {"assets": rows, "total_usd": total if known else None}


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
        # 合约钱包里逐个币的余额。把 BNB 划进来当保证金 / 抵手续费是常见做法，
        # 只看现货余额的话这些币就凭空消失了——成本基础按"账户一共有多少"算，
        # 不认钱包。
        "assets": [
            {"asset": a.get("asset", ""),
             "wallet_balance": dec0(a.get("walletBalance")),
             "margin_balance": dec0(a.get("marginBalance")),
             "available": dec0(a.get("availableBalance"))}
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
        # 同上：杠杆账户里也可能躺着现货币种
        "assets": [
            {"asset": a.get("asset", ""),
             "free": dec0(a.get("free")), "locked": dec0(a.get("locked")),
             "borrowed": dec0(a.get("borrowed")), "net": dec0(a.get("netAsset"))}
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




def _daily_realized(income_rows: Any, spot_days: dict[str, float],
                    prices: dict[str, float], days: int, now: datetime) -> list[dict]:
    """每天落袋多少。日历图与"今日已实现"都用它。

    "已实现"含**当天实际结算掉的全部**：合约的已实现盈亏、资金费、手续费、返佣，
    加上现货卖出结转的部分。资金费与手续费也是真金白银的进出，只报 REALIZED_PNL
    会让"这天赚了多少"偏乐观。

    换掉净值走势图的理由：那条线来自日快照，而快照只有三个钱包，钱包间划转会让它
    凭空抬升或塌陷——图上看着像赚了，其实只是把钱挪了个地方。每日已实现不受划转
    影响，因为它只认成交与结算。
    """
    buckets: dict[str, float] = {}
    for row in income_rows or []:
        if row.get("incomeType") in ("TRANSFER", "INTERNAL_TRANSFER"):
            continue
        day = (ms_to_iso(row.get("time")) or "")[:10]
        if not day:
            continue
        usd = usd_value(row.get("asset", ""), dec0(row.get("income")), prices)
        if usd is None:
            continue
        buckets[day] = buckets.get(day, 0.0) + usd
    for day, amount in spot_days.items():
        buckets[day] = buckets.get(day, 0.0) + amount

    # 用传进来的 now，不自己读时钟：`build_portfolio` 全程用同一个 now，
    # 这里另读一次的话，测试里固定的 NOW 与真实时钟一跨天就对不上——
    # 而且真实运行时也会出现"页面时刻是昨天、日历最后一格是今天"的错位。
    today = now.astimezone(timezone.utc).date()
    out = []
    for back in range(days - 1, -1, -1):
        day = (today - timedelta(days=back)).isoformat()
        out.append({"date": day, "realized_usd": buckets.get(day, 0.0),
                    "traded": day in buckets})
    return out


def _pnl(spot_cost: dict | None, spot_today: dict, futures: dict | None,
         income: dict | None, daily: list[dict]) -> dict | None:
    """盈亏构成。**每一项都有出处，没有残差项。**

    原先这里是"期末 − 期初 − 净充提"，剩下的靠残差反解未实现变动。那条路在
    Binance 上走不通：日快照只有三个钱包，理财 / 资金 / 币本位没有历史快照，
    "全部钱包的期初"取不到；而只覆盖三个钱包的话，**钱包之间的划转会被算成盈亏**。
    残差又会把这类口径错误照单全收，瀑布照样闭合——错了很久没人看得出来。

    成交法对划转免疫：划转不是成交。

        今日   = 现货盯市（持有量 ×（现价 − 昨收））+ 当日结算
        未实现 = **只有合约**：positionRisk 的 unRealizedProfit
        已实现 = 现货卖出结转的 + 合约 REALIZED_PNL
        其他   = 资金费 + 手续费 + 返佣

    **现货没有"未实现"这一项。** 它曾经算的是市值减加权平均成本，可那个成本要
    完整的买入历史，而划转 / 派息 / 小额兑换进来的币在 `myTrades` 里没有痕迹，
    90 天以前的充值也查不回来——算出来永远缺一块。现货要看的是今天涨跌了多少，
    盯市就够，不需要任何历史。合约那半边不一样：`unRealizedProfit` 是交易所按
    自己的开仓均价给的，拿来即用，不需要我们重建成本。

    窗口不一样，是接口的硬限，不是选择：
    - 现货成交 `myTrades` 用 fromId 翻页，**没有时间上限**，是全历史
    - 合约 `income` **只保留 90 天**，`userTrades` 同样只有 90 天
    - 盯市与合约未实现都是**此刻**的值，没有窗口概念

    所以界面上必须分开写，不能加成一个数说"这段时间赚了多少"。
    """
    spot_real = (spot_cost or {}).get("realized_usd")
    fut_unreal = (futures or {}).get("total_unrealized_pnl")
    fut_real = (income or {}).get("realized_pnl")
    mark = spot_today.get("total_usd")
    settled = daily[-1]["realized_usd"] if daily else None

    def total(*parts):
        known = [p for p in parts if p is not None]
        return sum(known) if known else None

    if spot_cost is None and futures is None and income is None:
        return None
    return {
        # 今天赚了多少。**两项加起来，别只报一项**：不交易的日子结算是 0，
        # 只报结算的话屏幕上永远是 $0.00，而持仓明明在涨跌。
        "today": {
            "spot_mark_usd": mark,
            "settled_usd": settled,
            "total_usd": total(mark, settled),
        },
        "today_usd": total(mark, settled),
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
        # 每天落袋多少。**只含结算**（成交结转 + 资金费 + 手续费），不含盯市——
        # 往前的每一天要盯市就得知道那天持有多少，而历史持仓量拿不到。
        # 所以最后一格 ≠ `today.total_usd`，差的就是今天的盯市那一项。
        "daily": daily,
        # 逐币的今日涨跌。数量跨全部钱包，划进合约当保证金的也算在里面。
        "spot_marks": spot_today.get("assets", []),
        "spot_assets": (spot_cost or {}).get("assets", []),
        "coverage": (spot_cost or {}).get("coverage"),
        "incomplete_assets": (spot_cost or {}).get("incomplete_assets", []),
        "failed_symbols": (spot_cost or {}).get("failed_symbols", []),
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
        payload("futures.risk"), payload("futures.adl")))
    earn = block("earn", lambda: _earn(payload("earn.flexible"),
                                       payload("earn.locked"), prices), fallback=[]) or []
    margin = block("margin", lambda: _margin(payload("margin"), btc_usd))
    income = block("income", lambda: _income(payload("income"), prices))
    transfers = block("transfers", lambda: _transfers(
        payload("transfers.deposits"), payload("transfers.withdrawals"), prices))
    # --- 第二阶段：按交易对取的东西 ----------------------------------------
    # `myTrades` 与 `klines` 的 symbol 都必填，而"持有哪些币"要先看余额——余额本身
    # 是第一阶段的来源，所以只能分两轮。第二轮很小，多一次往返换一个不靠残差的
    # 盈亏数，值得。
    spot_realized_days: dict[str, float] = {}
    held = held_across_wallets(spot, futures, margin, earn)
    cost_symbols = _cost_symbols(held, prices)
    trade_results: dict[str, SourceResult] = {}
    prev_closes: dict[str, float] = {}
    if cost_symbols:
        trade_results = fetch_all(cache,
                                  _trade_jobs(client, cost_symbols)
                                  + _close_jobs(client, cost_symbols),
                                  force=False, never_force=NEVER_FORCE)
        results.update(trade_results)
        prev_closes = _prev_closes(trade_results, cost_symbols)

    spot_today = _spot_today(held, prices, prev_closes)

    def cost_basis() -> dict | None:
        trades = []
        missing = []
        for sym in cost_symbols:
            res = trade_results.get(f"trades.{sym}")
            if res is None or not res.ok:
                missing.append(sym)
                continue
            for row in res.payload or []:
                trades.append({**row, "symbol": sym})
        if missing and len(missing) == len(cost_symbols):
            return None
        lots = replay(trades,
                      deposits=payload("transfers.deposits") or [],
                      rewards=[])
        out = summarize(lots, {a: usd_price(a, prices) for a in held} | {"USDT": 1.0},
                        held=held)
        nonlocal spot_realized_days
        spot_realized_days = realized_by_day(lots)
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
            block("cost_basis", cost_basis), spot_today, futures, income,
            _daily_realized(payload("income"), spot_realized_days, prices,
                            WINDOW_DAYS, now))),
    }
