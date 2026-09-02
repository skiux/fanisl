"""现货成本基础的重放。

这一组全是纯逻辑，不碰网络——口径对不对在这里定死，接口那层只负责把成交喂进来。
"""

import pytest

from analyzer.binance.costbasis import (
    Lot, held_across_wallets, replay, split_symbol, summarize,
)

DAY = 86_400_000


def trade(symbol: str, *, buy: bool, qty: float, price: float, at: int,
          fee: float = 0.0, fee_asset: str = "") -> dict:
    return {"symbol": symbol, "isBuyer": buy, "qty": str(qty), "price": str(price),
            "time": at, "commission": str(fee), "commissionAsset": fee_asset}


# --- 拆 symbol -------------------------------------------------------------

def test_split_symbol_prefers_the_longest_quote():
    assert split_symbol("BNBUSDT") == ("BNB", "USDT")
    # BUSD 与 USD 是包含关系：先试短的会把 ETHBUSD 切成 ETHB + USD
    assert split_symbol("ETHBUSD") == ("ETH", "BUSD")
    assert split_symbol("USDT") is None          # 只有计价币，没有标的
    assert split_symbol("BNBBTC") is None        # 默认只认稳定币计价


# --- 加权平均 --------------------------------------------------------------

def test_weighted_average_moves_with_each_buy():
    lots = replay([
        trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY),
        trade("BNBUSDT", buy=True, qty=10, price=700, at=2 * DAY),
    ])
    assert lots["BNB"].qty == pytest.approx(20)
    assert lots["BNB"].avg_cost == pytest.approx(650)
    assert lots["BNB"].realized_usd == pytest.approx(0)


def test_partial_sell_realizes_against_the_average_and_leaves_it_unchanged():
    lots = replay([
        trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY),
        trade("BNBUSDT", buy=True, qty=10, price=700, at=2 * DAY),
        trade("BNBUSDT", buy=False, qty=5, price=800, at=3 * DAY),
    ])
    bnb = lots["BNB"]
    assert bnb.qty == pytest.approx(15)
    assert bnb.avg_cost == pytest.approx(650)          # 卖出不改均价
    assert bnb.realized_usd == pytest.approx(5 * 150)  # 5 × (800 − 650)


def test_selling_everything_matches_fifo():
    """全部卖光时加权平均与 FIFO 结果一致——分歧只在中途部分卖出的分摊上。"""
    lots = replay([
        trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY),
        trade("BNBUSDT", buy=True, qty=10, price=700, at=2 * DAY),
        trade("BNBUSDT", buy=False, qty=20, price=800, at=3 * DAY),
    ])
    bnb = lots["BNB"]
    assert bnb.qty == 0 and bnb.cost_usd == 0
    # 收入 16000 − 成本 13000
    assert bnb.realized_usd == pytest.approx(3000)


def test_stablecoins_are_cash_not_a_position_with_a_cost():
    """USDT 是计价单位：均价恒为 1，盈亏恒为 0，也不因为"没见过它怎么进来的"
    而被标成成本不明——标了就会把账户里最大的一块从已实现合计里剔掉。"""
    lots = replay([trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY)])
    usdt = lots["USDT"]
    assert usdt.is_cash is True
    assert usdt.unknown_cost is False
    assert usdt.avg_cost == 1.0
    assert usdt.realized_usd == 0.0
    assert usdt.qty == pytest.approx(-6000)   # 花出去 6000，我们没看到它怎么进来的


def test_cash_never_lands_in_incomplete_assets():
    lots = replay([trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY)])
    out = summarize(lots, {"BNB": 700.0, "USDT": 1.0}, held={"BNB": 10.0, "USDT": 5000.0})
    assert out["incomplete_assets"] == []
    usdt = next(r for r in out["assets"] if r["asset"] == "USDT")
    assert usdt["is_cash"] is True
    assert usdt["unrealized_usd"] == pytest.approx(0.0)


# --- 手续费 ----------------------------------------------------------------

def test_bnb_fee_only_reduces_bnb_quantity_not_the_trade_cost():
    """BNB 抵扣的手续费从 BNB 余额里出，它的成本在 BNB 自己账上，不能再扣一次。"""
    lots = replay([
        trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY),
        trade("ETHUSDT", buy=True, qty=1, price=3000, at=2 * DAY,
              fee=0.01, fee_asset="BNB"),
    ])
    assert lots["ETH"].avg_cost == pytest.approx(3000)   # ETH 的成本没被手续费污染
    assert lots["BNB"].qty == pytest.approx(9.99)        # BNB 少了 0.01


# --- 充值与派息 ------------------------------------------------------------

def test_deposit_takes_the_market_price_at_arrival_as_its_cost():
    """充值进来的币在别处的买入价看不到；按 0 成本算的话会显示成 100% 的利润。"""
    lots = replay([], deposits=[{"coin": "BNB", "amount": "5", "insertTime": DAY}],
                  usd_rate=lambda asset, at: 600.0 if asset == "BNB" else None)
    assert lots["BNB"].qty == pytest.approx(5)
    assert lots["BNB"].avg_cost == pytest.approx(600)


def test_rewards_count_as_realized_not_as_a_price_rise():
    """派息是白得的。只记成本不记已实现的话，它会在"未实现"里冒出来，像持仓涨了。"""
    lots = replay([], rewards=[{"asset": "USDT", "rewards": "12.5", "time": DAY}])
    assert lots["USDT"].qty == pytest.approx(12.5)
    assert lots["USDT"].realized_usd == pytest.approx(12.5)


def test_deposit_and_trade_in_the_same_millisecond_do_not_go_negative():
    """同毫秒时先记进账再记成交，否则卖出会先跑而把持仓算成负的。"""
    lots = replay([trade("BNBUSDT", buy=False, qty=5, price=700, at=DAY)],
                  deposits=[{"coin": "BNB", "amount": "5", "insertTime": DAY}],
                  usd_rate=lambda asset, at: 600.0 if asset == "BNB" else None)
    assert lots["BNB"].qty == 0
    assert lots["BNB"].realized_usd == pytest.approx(5 * 100)


# --- 算不出来的时候 --------------------------------------------------------

def test_cross_currency_trade_without_a_rate_marks_the_asset_unknown():
    """用 BTC 买的东西要成交当时的 BTC/USD。取不到就留空，不猜一个均价。"""
    lots = replay([{"symbol": "BNBBTC", "isBuyer": True, "qty": "10",
                    "price": "0.007", "time": DAY, "commission": "0",
                    "commissionAsset": ""}])
    assert lots["BNB"].unknown_cost is True
    assert lots["BNB"].avg_cost is None


def test_selling_more_than_we_saw_bought_marks_unknown_instead_of_going_negative():
    lots = replay([
        trade("BNBUSDT", buy=True, qty=2, price=600, at=DAY),
        trade("BNBUSDT", buy=False, qty=5, price=700, at=2 * DAY),
    ])
    bnb = lots["BNB"]
    assert bnb.qty == 0                # 不会变成 −3
    assert bnb.unknown_cost is True
    assert bnb.avg_cost is None


# --- 汇总 ------------------------------------------------------------------

def test_summary_trusts_the_real_balance_for_quantity():
    """重放出来的数量会和真实余额对不上（有过没看到的划入）。数量信余额，
    均价信重放——反过来的话，这一页的持仓会和资产页打架。"""
    lots = replay([trade("BNBUSDT", buy=True, qty=10, price=600, at=DAY)])
    out = summarize(lots, {"BNB": 700.0}, held={"BNB": 12.0})
    bnb = next(r for r in out["assets"] if r["asset"] == "BNB")
    assert bnb["qty"] == pytest.approx(12)
    assert bnb["avg_cost_usd"] == pytest.approx(600)
    assert bnb["unrealized_usd"] == pytest.approx(12 * 700 - 12 * 600)


def test_summary_reports_which_assets_have_no_usable_cost():
    lot = Lot()
    lot.qty, lot.unknown_cost = 3.0, True
    out = summarize({"XYZ": lot}, {"XYZ": 5.0})
    assert out["incomplete_assets"] == ["XYZ"]
    row = out["assets"][0]
    assert row["avg_cost_usd"] is None and row["unrealized_usd"] is None
    assert row["realized_usd"] is None and row["cost_known"] is False


# --- 跨钱包持有量 ----------------------------------------------------------

def test_held_sums_every_wallet_not_just_spot():
    """把 BNB 划进合约当保证金、或存进理财，持有量一点没变——只看现货会显示成卖掉了。"""
    held = held_across_wallets(
        spot=[{"asset": "BNB", "total": 2.0}, {"asset": "USDT", "total": 100.0}],
        futures={"assets": [{"asset": "BNB", "wallet_balance": 3.0, "margin_balance": 3.5},
                            {"asset": "USDT", "wallet_balance": 8000.0}]},
        margin={"assets": [{"asset": "BNB", "net": 1.0}]},
        earn=[{"asset": "BNB", "amount": 1.5}],
    )
    assert held["BNB"] == pytest.approx(7.5)     # 2 + 3 + 1 + 1.5
    assert held["USDT"] == pytest.approx(8100.0)


def test_held_uses_wallet_balance_not_margin_balance():
    """marginBalance 含未实现盈亏，那是仓位的浮盈，不是多出来的币。"""
    held = held_across_wallets(spot=[], futures={
        "assets": [{"asset": "USDT", "wallet_balance": 8000.0, "margin_balance": 9500.0}],
    }, margin=None, earn=[])
    assert held["USDT"] == pytest.approx(8000.0)


def test_held_excludes_borrowed_coins():
    """杠杆里借来的币不是自己的持仓，netAsset 已经把它减掉了。"""
    held = held_across_wallets(spot=[], futures=None, earn=[], margin={
        "assets": [{"asset": "BNB", "free": 10.0, "borrowed": 4.0, "net": 6.0}],
    })
    assert held["BNB"] == pytest.approx(6.0)
