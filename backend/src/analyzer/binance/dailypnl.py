"""每天到底赚了多少：按当天的持仓量与当天的收盘价算。

## 为什么日历原来是错的

原来一格 = 那天**结算掉**的钱（合约已实现 + 资金费 + 手续费 + 现货卖出结转）。
可现货不成交也在赚钱亏钱——拿着 6 个 BNB 什么都不做，涨 10 块就是赚 60 块。
于是不交易的日子全是 0，而账户明明在动。那不是"这天没赚没亏"，是"这天没成交"。

## 口径

一天的盈亏 = 这天收盘的市值 − 昨天收盘的市值 − 这天进出的钱：

    盈亏_d = q_d × close_d − q_{d−1} × close_{d−1} − 进出_d

`进出_d` 按每笔的**单位成本**折算，这一项决定了同一笔数量变化算不算收益：

    成交            单位成本 = 成交价    → 买入当天只赚"成交价到收盘"那一段
    充值 / 提现     单位成本 = 当日收盘  → 钱进来不是赚的，当天贡献 0
    合约结算        单位成本 = 当日收盘  → 它已经在"当日结算"那半边算过一次
    理财派息        单位成本 = 0         → 白得的，全额算收益

展开验一下买入：`(q+a)·close − q·close₋₁ − a·p = q·(close − close₋₁) + a·(close − p)`
——持仓那部分照涨跌算，新买的那部分从成交价算起。这正是想要的。

## 每天的持仓量从哪来

**没有"历史余额"这个接口**，只能从今天的余额往回滚：

    q_{d−1} = q_d − （d 这天的净进出）

关键是持仓量按**跨全部钱包**统计（`held_across_wallets`）。这样钱包之间的划转
自动抵消——从现货挪进合约、存进理财都不改变总量，根本不用去查划转记录。
真正会改变总量的只有：成交、充提、合约结算、理财派息、杠杆利息、闪兑、小额兑换。

回滚出负数说明有一类进出没被覆盖到（这个账户上最可能是 90 天以外的充值，
那个接口回不了那么远）。**那天报 `None`，不报一个错的数**——`unknown_days`
把是哪几天说出来。

## 相对成本的那套东西整个不用了

旧的日历把"现货卖出相对加权平均成本的结转"也加进当天。新口径里卖出那笔的盈亏
已经含在市值变化里了（卖出当天 `a × (close − p)` 那一项），再加一次就是重复计。

那套成本基础引擎后来整个删了——买入历史补不齐，均价与已实现都会无声出错，
理由见 `costbasis.py` 的模块注释。现货这一侧只剩这里算的每日涨跌。
"""

from __future__ import annotations

from datetime import date as Date, datetime, timedelta, timezone
from typing import Any, Iterable

from .common import dec, dec0, ms_to_iso
from .costbasis import USD_QUOTES, split_symbol


def _day(value: Any) -> str:
    return (ms_to_iso(value) or "")[:10]


def flow(day: str, asset: str, dq: float, unit_usd: float | None) -> dict:
    """一笔进出。`unit_usd=None` 表示按当日收盘计价（本身不产生盈亏）。"""
    return {"day": day, "asset": asset, "dq": dq, "unit_usd": unit_usd}


def collect_flows(*, trades: Iterable[dict] = (), deposits: Any = None,
                  withdrawals: Any = None, income: Any = None,
                  earn_flexible: Any = None, earn_locked: Any = None,
                  margin_interest: Any = None, convert: Any = None,
                  dust: Any = None) -> list[dict]:
    """各来源的原始行 → 统一的进出清单。

    **钱包之间的划转不在这里**，也不需要：持仓量按跨钱包统计，划转两头相抵。
    """
    out: list[dict] = []

    for row in trades or []:
        pair = split_symbol(row.get("symbol", ""), _QUOTES)
        if pair is None:
            continue
        base, quote = pair
        qty, price = dec0(row.get("qty")), dec(row.get("price"))
        day = _day(row.get("time"))
        if qty <= 0 or price is None or not day:
            continue
        side = 1.0 if row.get("isBuyer") else -1.0
        out.append(flow(day, base, side * qty, price))
        # 计价币那一侧反向。稳定币会被上层过滤掉，币本位计价对时要用得上
        out.append(flow(day, quote, -side * qty * price, 1.0 if quote in USD_QUOTES else None))
        # 手续费：币出去了、什么都没换回来，所以单位成本是 0——全额算亏。
        # 用 BNB 抵扣时扣的是 BNB 的量，这里如实反映。
        fee, fee_asset = dec0(row.get("commission")), row.get("commissionAsset", "")
        if fee > 0 and fee_asset:
            out.append(flow(day, fee_asset, -fee, 0.0))

    for row in (deposits or []):
        day, amount = _day(row.get("insertTime")), dec0(row.get("amount"))
        # status 1 = 已到账。挂起中的还没进余额，算进来会让那天凭空多一笔
        if day and amount > 0 and row.get("status") == 1:
            out.append(flow(day, row.get("coin", ""), amount, None))

    for row in (withdrawals or []):
        day = (row.get("applyTime") or "")[:10]
        amount = dec0(row.get("amount")) + dec0(row.get("transactionFee"))
        if day and amount > 0 and row.get("status") == 6:
            out.append(flow(day, row.get("coin", ""), -amount, None))

    for row in (income or []):
        kind = row.get("incomeType")
        # 划转两头相抵，不必记
        if kind in ("TRANSFER", "INTERNAL_TRANSFER"):
            continue
        day, amount = _day(row.get("time")), dec(row.get("income"))
        if day and amount:
            # 单位成本按当日收盘：这笔的损益已经在"当日结算"那半边算过一次了
            out.append(flow(day, row.get("asset", ""), amount, None))

    for row in _rows(earn_flexible):
        day, amount = _day(row.get("time")), dec0(row.get("rewards"))
        if day and amount > 0:
            out.append(flow(day, row.get("asset", ""), amount, 0.0))
    for row in _rows(earn_locked):
        day, amount = _day(row.get("time")), dec0(row.get("amount"))
        if day and amount > 0:
            out.append(flow(day, row.get("asset", ""), amount, 0.0))

    for row in _rows(margin_interest):
        day = _day(row.get("interestAccuredTime") or row.get("interestAccruedTime"))
        amount = dec0(row.get("interest"))
        if day and amount > 0:
            out.append(flow(day, row.get("asset", ""), -amount, 0.0))

    for row in ((convert or {}).get("list", []) if isinstance(convert, dict) else []):
        if row.get("orderStatus") != "SUCCESS":
            continue
        day = _day(row.get("createTime"))
        got, gave = dec0(row.get("toAmount")), dec0(row.get("fromAmount"))
        if not day or got <= 0 or gave <= 0:
            continue
        # 闪兑按市价换：两头都按当日收盘计价，当天的盈亏因此是 0——换币不是赚钱。
        out.append(flow(day, row.get("toAsset", ""), got, None))
        out.append(flow(day, row.get("fromAsset", ""), -gave, None))

    for row in ((dust or {}).get("userAssetDribblets", [])
                if isinstance(dust, dict) else []):
        day = _day(row.get("operateTime"))
        got = dec0(row.get("totalTransferedAmount"))
        if day and got > 0:
            out.append(flow(day, "BNB", got, None))
        for detail in row.get("userAssetDribbletDetails") or []:
            gave = dec0(detail.get("amount"))
            if day and gave > 0:
                out.append(flow(day, detail.get("fromAsset", ""), -gave, None))

    return [f for f in out if f["asset"]]


_QUOTES = (*USD_QUOTES, "BTC", "ETH", "BNB")


def _rows(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        return payload.get("rows", []) or []
    return payload if isinstance(payload, list) else []


def daily_spot_pnl(held: dict[str, float], closes: dict[str, dict[str, float]],
                   flows: Iterable[dict], *, days: int, now: datetime) -> dict:
    """逐日的现货盈亏。

    `held`   跨全部钱包的**当前**持有量（`held_across_wallets`）
    `closes` `{资产: {日期: 当日 UTC 收盘价}}`，要比窗口多一天（算第一天要昨收）
    `flows`  `collect_flows` 的输出

    稳定币不参与：面值不动，算出来是噪声，而它们的进出量最大、最容易把误差放大。
    没有报价对的币整个不参与（`unpriced_assets`），与净值同一个口径——
    让一个几分钱的尘埃仓位把整张日历抹空是最坏的选择。
    """
    today = now.astimezone(timezone.utc).date()
    dates = [(today - timedelta(days=back)).isoformat() for back in range(days - 1, -1, -1)]

    by_asset: dict[str, dict[str, list[dict]]] = {}
    for f in flows:
        if f["asset"] in USD_QUOTES:
            continue
        by_asset.setdefault(f["asset"], {}).setdefault(f["day"], []).append(f)

    assets = {a for a, q in held.items() if a not in USD_QUOTES and q != 0} | set(by_asset)

    # **没有币可算 ≠ 那天没赚没亏。** 起手全是 None，有币真的算出来才落成数字；
    # 行情整个取不到时（`cost_symbols` 为空、拿不到任何日线）就该是空，不是 0。
    # 唯一的例外在最后：账户里本来就没有非稳定币，那 0 是真的。
    totals: dict[str, float | None] = {d: None for d in dates}
    unknown: dict[str, set[str]] = {}
    negative: set[str] = set()
    # 今天逐币赚了多少，给详情抽屉用。和合计同源，不另算一遍
    today_by_asset: dict[str, dict] = {}

    unpriced: list[str] = []
    for asset in sorted(assets):
        series = closes.get(asset) or {}
        # **压根没有报价的币整个不参与**，而不是让它把每一天都作废。
        # 净值里也不含它（`value_usd` 是 null）——两处口径一致。
        # 曾经写成"任一持有的币缺价 ⇒ 那天报空"，结果一个几分钱的尘埃仓位
        # （0.00071 PAXG，没有 USDT 对）把整张 90 天日历抹成了空白。
        if not series:
            unpriced.append(asset)
            continue
        qty = held.get(asset, 0.0)
        for date in reversed(dates):
            day_flows = by_asset.get(asset, {}).get(date, [])
            prev_qty = qty - sum(f["dq"] for f in day_flows)
            # 这个币那天根本不在账上：不算，也不因为它没有报价就把整天作废
            if abs(qty) < 1e-12 and abs(prev_qty) < 1e-12 and not day_flows:
                qty = prev_qty
                continue
            close = series.get(date)
            prev_close = series.get((Date.fromisoformat(date) - timedelta(days=1)).isoformat())
            # 回滚出负数 = 有一类进出没覆盖到（多半是 90 天以外的充值）。
            # 夹到 0 只会把误差往前推，如实记下来、那天报空。
            if prev_qty < -1e-9:
                negative.add(asset)
                unknown.setdefault(date, set()).add(asset)
            if close is None or prev_close is None:
                unknown.setdefault(date, set()).add(asset)
            else:
                spent = sum(f["dq"] * (close if f["unit_usd"] is None else f["unit_usd"])
                            for f in day_flows)
                gain = qty * close - prev_qty * prev_close - spent
                totals[date] = (totals[date] or 0.0) + gain
                if date == dates[-1]:
                    today_by_asset[asset] = {
                        "asset": asset, "qty": qty, "price_usd": close,
                        "prev_close_usd": prev_close, "value_usd": qty * close,
                        "today_usd": gain,
                    }
            if date == dates[-1] and asset not in today_by_asset:
                today_by_asset[asset] = {
                    "asset": asset, "qty": qty, "price_usd": close,
                    "prev_close_usd": prev_close, "value_usd": None,
                    "today_usd": None,
                }
            qty = prev_qty

    # 有币算不出来的那天整格留空：报一个"少了几个币"的合计比留空更误导
    for date, bad in unknown.items():
        if bad:
            totals[date] = None
    # 账户里根本没有非稳定币：那 0 是真的，不是"算不出来"
    if not assets:
        totals = {d: 0.0 for d in dates}

    return {
        "days": totals,
        "today_by_asset": [today_by_asset[a] for a in sorted(today_by_asset)],
        "unknown_days": sorted(d for d, v in totals.items() if v is None),
        # 没有报价对、整个算不进来的币。净值里同样不含它们
        "unpriced_assets": unpriced,
        # 回滚出负数的币。出现就说明进出清单缺了一类，值得查，不该沉默
        "unbalanced_assets": sorted(negative),
    }
