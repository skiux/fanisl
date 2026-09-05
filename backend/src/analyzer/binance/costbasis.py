"""持有量与交易对：把 Binance 的原始形状翻成"这个账户一共有多少某个币"。

原来这里还有一整套**成本基础**引擎（`Lot` / `replay` / `summarize`）：从成交明细
重放出每个币的持仓均价，再算相对成本的未实现与已实现。整套删了，理由是它答的
那个问题在这个账户上答不了——

**买入历史补不齐。** 划转、理财派息、小额兑换、闪兑进来的币在 `myTrades` 里没有
任何痕迹，`capital/deposit/hisrec` 又只回 90 天，更早的充值永远查不回来。均价缺一块，
未实现和已实现就都跟着偏。卖得比重放看到的还多时能被识破（那个币会被标成成本不明），
可**买得比看到的多、卖得不多时无声出错**——报一个看不出错的数比不报更糟。
为它修过三轮（虚高六倍 → 只算成本已知的那部分 → 开一条人工通道让人手填均价），
每一轮都是在给一个不该问的问题找答案。

**现货要回答的是"每天涨跌了多少"**，那只需要当天的持仓量与当天的收盘价，
不需要任何成本。见 `dailypnl.py`。合约那半边不受影响：`unRealizedProfit` 与
`REALIZED_PNL` 都是交易所按自己的开仓均价算好给的，拿来即用。

剩下的两件事仍然要做，所以留在这里：

- `split_symbol`：`BNBUSDT` → `("BNB", "USDT")`。Binance 的 symbol 不带分隔符。
- `held_across_wallets`：**跨全部钱包**的持有量。逐日盈亏的回滚全靠它——
  钱包之间的划转因此自动抵消，不必去查划转记录。
"""

from __future__ import annotations

from typing import Iterable

# 计价币是这些时，成交价就是美元价（差几个基点，对逐日盈亏没有意义）
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
