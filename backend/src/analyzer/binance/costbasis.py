"""现货的成本基础：从成交明细重放出每个币的持仓均价与已实现盈亏。

**为什么不能用资产差额法。** 原先"真实盈亏 = 期末净值 − 期初净值 − 净充提"这条路
在 Binance 上走不通：`accountSnapshot` 只有 SPOT / MARGIN / FUTURES 三种日快照，
理财、资金、币本位、期权没有历史快照，"全部钱包的期初"取不到。只覆盖三个钱包的话，
**钱包之间的划转会被算成盈亏**——从现货转 10000 USDT 进理财，就凭空亏 10000。
币安自己能用差额法是因为它看得见所有钱包，我们看不见。

成交法对划转完全免疫：划转不是成交，动不了任何一个币的数量与成本。

## 口径

**移动加权平均。** 买入时把成本并进去，卖出时按当时的均价结转：

    新均价 = (原持仓 × 原均价 + 买入量 × 买入价) / (原持仓 + 买入量)
    已实现 = 卖出量 × (卖出价 − 卖出时的均价)

不用 FIFO：FIFO 要维护完整的批次队列，而两者在**全部卖光**时结果完全一致，
只在中途部分卖出时分摊不同。加权平均更好解释，也是交易所面板的通行做法。

**手续费按计价币扣在成本上。** BNB 抵扣的手续费另算——那笔 BNB 是从余额里出的，
它自己的成本已经在 BNB 的账上，不能再从这笔交易的成本里扣一次。

**充值进来的币按到账时市价计入成本。** 它在别处的买入价我们看不到；当成 0 成本的话，
一笔从别的交易所转进来的 BNB 会显示成 100% 的利润。这也是 Binance 自己的口径：
盈亏从"资产进入这个账户"那一刻起算。

**只认能换算成 USD 的成交。** 计价币是 USDT / USDC 这类稳定币时直接按 1 美元算；
计价币是 BTC / ETH 时需要成交当时的汇率，取不到就整个币标为"成本不明"，
在界面上留空而不是给一个错的均价。

**这里只出已实现。** 现货的未实现盈亏不算——见 `summarize` 的注释：它需要完整的
买入历史，而那段历史补不齐。今天涨跌多少改用盯市（`portfolio._spot_today`）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from .common import dec, dec0

# 计价币是这些时，成交价就是美元价（差几个基点，对成本基础没有意义）
USD_QUOTES = ("USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "DAI")


def split_symbol(symbol: str, quotes: Iterable[str] = USD_QUOTES) -> tuple[str, str] | None:
    """`BNBUSDT` → `("BNB", "USDT")`。认不出计价币就返回 None。

    Binance 的 symbol 不带分隔符，只能按后缀试。先试长的：`USDC` 要排在 `USDT`
    之前无所谓，但 `BUSD` 与 `USD` 这种包含关系必须先试长的，否则 `ETHBUSD`
    会被切成 `ETHB` + `USD`。
    """
    for quote in sorted(quotes, key=len, reverse=True):
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return symbol[: -len(quote)], quote
    return None


class Lot:
    """一个币的持仓与成本。数量和成本都是"这个账户里现在有多少、花了多少"。

    **稳定币是现金，不是持仓。** USDT 的成本恒等于面值、盈亏恒为 0；把它当成
    有成本的仓位来记，会因为"没见过 USDT 的买入"而被标成成本不明，
    进而把它从已实现合计里剔掉——而它恰恰是账户里最大的一块。
    """

    __slots__ = ("qty", "cost_usd", "realized_usd", "unknown_cost", "is_cash",
                 "realized_by_day")

    def __init__(self, *, is_cash: bool = False) -> None:
        self.qty = 0.0
        self.cost_usd = 0.0
        self.realized_usd = 0.0
        # 按天分桶，给日历图用。卖出发生在哪天就记在哪天。
        self.realized_by_day: dict[str, float] = {}
        # 有一笔进账算不出美元成本（跨币种成交缺历史汇率、或来源不明）。
        # 一旦置位，这个币的均价就不再可信，界面上要留空。
        self.unknown_cost = False
        self.is_cash = is_cash

    @property
    def avg_cost(self) -> float | None:
        if self.is_cash:
            return 1.0
        if self.unknown_cost or self.qty <= 0:
            return None
        return self.cost_usd / self.qty

    def buy(self, qty: float, price_usd: float | None) -> None:
        if qty <= 0:
            return
        if self.is_cash:
            self.qty += qty
            self.cost_usd += qty
            return
        if price_usd is None:
            self.unknown_cost = True
            self.qty += qty
            return
        self.qty += qty
        self.cost_usd += qty * price_usd

    def sell(self, qty: float, price_usd: float | None, day: str = "") -> None:
        """卖出按卖出**当时**的均价结转，剩下的持仓均价不变。"""
        if qty <= 0:
            return
        if self.is_cash:
            # 现金花出去就是花出去，没有盈亏，也不因为"花得比看到的多"而变成不明——
            # 我们本来就看不全 USDT 是怎么进来的
            self.qty -= qty
            self.cost_usd -= qty
            return
        # 卖得比记录的还多，说明有进账没被看到（成交历史不全、或币是充值进来的
        # 而充值记录没覆盖）。把差额按 0 成本记，并标记这个币成本不明——
        # 悄悄让数量变成负数才是最糟的，那会让均价变成负的。
        if qty > self.qty + 1e-12:
            self.unknown_cost = True
            qty = self.qty if self.qty > 0 else 0.0
            if qty <= 0:
                return
        avg = self.cost_usd / self.qty if self.qty > 0 else 0.0
        if price_usd is not None and not self.unknown_cost:
            gain = qty * (price_usd - avg)
            self.realized_usd += gain
            if day:
                self.realized_by_day[day] = self.realized_by_day.get(day, 0.0) + gain
        elif price_usd is not None:
            # 成本不明时不记已实现——记了就是编一个数
            pass
        self.qty -= qty
        self.cost_usd -= qty * avg
        if self.qty <= 1e-12:
            self.qty = 0.0
            self.cost_usd = 0.0


def replay(trades: Iterable[dict], *, deposits: Iterable[dict] = (),
           rewards: Iterable[dict] = (), usd_rate: Any = None) -> dict[str, Lot]:
    """把成交与进账按时间重放成每个币的 `Lot`。

    `trades`   现货成交（`/api/v3/myTrades` 的原样行，需带 `symbol`）
    `deposits` 充值（`/sapi/v1/capital/deposit/hisrec`），按到账时市价计入成本
    `rewards`  理财派息一类的白得收益，按到账时市价计入成本、同额记为已实现
    `usd_rate` `(asset, time_ms) -> float | None`，非稳定币计价时用来换算。
               给 None 表示"没有历史汇率"，跨币种成交会把该币标为成本不明。
    """
    lots: dict[str, Lot] = {}

    def lot(asset: str) -> Lot:
        if asset not in lots:
            lots[asset] = Lot(is_cash=asset in USD_QUOTES)
        return lots[asset]

    def rate(asset: str, at: int) -> float | None:
        if asset in USD_QUOTES:
            return 1.0
        return usd_rate(asset, at) if usd_rate else None

    events: list[tuple[int, int, dict]] = []
    # 第二个键是同一毫秒内的排序：先进账再成交，免得"充值到账与买入同毫秒"时
    # 卖出先跑而把持仓算成负的
    for row in deposits or []:
        events.append((_ms(row.get("insertTime")), 0, {"kind": "deposit", "row": row}))
    for row in rewards or []:
        events.append((_ms(row.get("time")), 0, {"kind": "reward", "row": row}))
    for row in trades or []:
        events.append((_ms(row.get("time")), 1, {"kind": "trade", "row": row}))
    events.sort(key=lambda e: (e[0], e[1]))

    for at, _, event in events:
        row = event["row"]
        if event["kind"] == "trade":
            _apply_trade(lot, row, at, rate, _day_of(at))
        else:
            asset = row.get("coin") or row.get("asset") or ""
            amount = dec0(row.get("amount") or row.get("rewards"))
            if not asset or amount <= 0:
                continue
            price = rate(asset, at)
            lot(asset).buy(amount, price)
            if event["kind"] == "reward" and price is not None:
                # 派息是白得的：成本记市价，同时把这一笔记成已实现收益，
                # 否则它会在"未实现"里冒出来，看着像持仓涨了
                lot(asset).realized_usd += amount * price
    return lots


def _apply_trade(lot, row: dict, at: int, rate, day: str = "") -> None:
    pair = split_symbol(row.get("symbol", ""), _QUOTE_GUESSES)
    if pair is None:
        return
    base, quote = pair
    qty = dec0(row.get("qty"))
    price = dec(row.get("price"))
    if qty <= 0 or price is None:
        return
    quote_usd = rate(quote, at)
    price_usd = None if quote_usd is None else price * quote_usd

    if row.get("isBuyer"):
        lot(base).buy(qty, price_usd)
        lot(quote).sell(qty * price, rate(quote, at))
    else:
        lot(base).sell(qty, price_usd, day)
        lot(quote).buy(qty * price, rate(quote, at))

    # 手续费。用 BNB 抵扣时那笔 BNB 从余额里出，它的成本在 BNB 自己账上，
    # 这里只把数量扣掉；手续费收计价币时，才算进这笔交易的成本。
    fee = dec0(row.get("commission"))
    fee_asset = row.get("commissionAsset", "")
    if fee > 0 and fee_asset:
        lot(fee_asset).sell(fee, rate(fee_asset, at))


# 拆 symbol 时除了稳定币还要认得出常见的币本位计价，否则 `BNBBTC` 会被整条丢掉
_QUOTE_GUESSES = (*USD_QUOTES, "BTC", "ETH", "BNB")


def _day_of(ms: int) -> str:
    """毫秒 → UTC 日期。日历按 UTC 分桶，与 Binance 的结算日一致。"""
    if ms <= 0:
        return ""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()


def realized_by_day(lots: dict[str, Lot]) -> dict[str, float]:
    """全部币加起来，每天现货结转了多少。"""
    out: dict[str, float] = {}
    for lot in lots.values():
        if lot.unknown_cost and not lot.is_cash:
            continue
        for day, amount in lot.realized_by_day.items():
            out[day] = out.get(day, 0.0) + amount
    return out


def _ms(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def held_across_wallets(spot: list[dict], futures: dict | None,
                        margin: dict | None, earn: list[dict]) -> dict[str, float]:
    """一个币在**整个账户**里有多少，不分钱包。

    成本基础不认钱包：把 BNB 从现货划进合约当保证金、或者存进理财吃利息，
    持有量一点没变，只是换了个地方待着。只看现货余额的话，划走的那部分会显示成
    "卖掉了"——而实际上一笔成交都没发生。

    资金钱包不在这里：`/sapi/v1/asset/wallet/balance` 只给 BTC 估值，没有逐币明细，
    要另开 `/sapi/v1/asset/get-funding-asset`。缺它的后果是资金钱包里的币算不进
    持有量，`summarize` 会照 `held` 报数——所以调用方拿不到就别传，宁可用重放的数量。
    """
    out: dict[str, float] = {}

    def add(asset: str, qty: float) -> None:
        if asset and qty:
            out[asset] = out.get(asset, 0.0) + qty

    for row in spot or []:
        add(row.get("asset", ""), row.get("total", 0.0))
    for row in (futures or {}).get("assets", []):
        # 用 walletBalance 而不是 marginBalance：后者含未实现盈亏，
        # 那是合约仓位的浮盈，不是多出来的币
        add(row.get("asset", ""), row.get("wallet_balance", 0.0))
    for row in (margin or {}).get("assets", []):
        # netAsset = free + locked − borrowed。借来的币不是自己的持仓
        add(row.get("asset", ""), row.get("net", 0.0))
    for row in earn or []:
        add(row.get("asset", ""), row.get("amount", 0.0))
    return out


def summarize(lots: dict[str, Lot], prices: dict[str, float],
              held: dict[str, float] | None = None) -> dict:
    """`Lot` → 给接口的形状。**只出已实现，不出未实现。**

    `held` 是账户里实际的余额，数量以它为准：重放出来的数量常常比余额少
    （成交历史只覆盖能猜到交易对的那部分，划转 / 理财派息 / 小额兑换进来的币
    从来没出现在 myTrades 里）。

    **现货的未实现盈亏不在这里算，哪儿也不算。** 它是市值减加权平均成本，而那个
    成本要完整的买入历史——上面这条缺口补不齐（`capital/deposit/hisrec` 只回 90 天，
    更早的充值永远查不回来）。硬算过一版：拿 `cost_usd / lot.qty` 的均价去乘 `held`
    的全部数量，等于假设没见过买入记录的币和见过的同价，实测重放 1 个 BNB @ $650、
    实际持有 6.712 个，未实现算成 +$215.79，有据可依的只有 +$32.15。
    补丁版（只算 `min(余额, 重放数量)`）不再虚高，但报出来的仍是一个永远缺一块的数。

    现货要回答的是"今天涨跌了多少"，那用**盯市**：`持有量 ×（现价 − 昨收）`，
    只要数量和两个价格，不需要任何历史。见 `portfolio._spot_today`。

    已实现是另一回事，它**只认真实发生过的卖出**，重放能给全，所以留在这里。
    """
    rows = []
    realized = 0.0
    incomplete = []
    for asset, lot in sorted(lots.items()):
        qty = held.get(asset, lot.qty) if held is not None else lot.qty
        price = prices.get(asset)
        avg = lot.avg_cost
        if lot.unknown_cost and not lot.is_cash:
            incomplete.append(asset)
        else:
            realized += lot.realized_usd
        if qty <= 0 and abs(lot.realized_usd) < 1e-9:
            continue
        rows.append({
            "asset": asset,
            "qty": qty,
            # 均价只对重放到的那部分成立，别拿它去乘 qty
            "avg_cost_usd": avg,
            "price_usd": price,
            "value_usd": None if price is None else qty * price,
            "realized_usd": None if (lot.unknown_cost and not lot.is_cash)
                            else lot.realized_usd,
            "cost_known": lot.is_cash or not lot.unknown_cost,
            "is_cash": lot.is_cash,
        })
    return {
        "assets": rows,
        "realized_usd": realized,
        # 哪些币的成本算不出来。界面上要说出来，不能让人以为总数是全的。
        "incomplete_assets": incomplete,
    }
