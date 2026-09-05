"""交易对拆分与跨钱包持有量。

成本基础引擎（`Lot` / `replay` / `summarize`）连同它的测试一起删了，理由见
`costbasis.py` 的模块注释：买入历史补不齐，算出来的均价与已实现会无声出错。
现货改看每天涨跌，口径测试在 `test_dailypnl.py`。
"""

import pytest

from analyzer.binance.costbasis import held_across_wallets, split_symbol


def test_split_symbol_prefers_the_longest_quote():
    assert split_symbol("BNBUSDT") == ("BNB", "USDT")
    # BUSD 与 USD 是包含关系：先试短的会把 ETHBUSD 切成 ETHB + USD
    assert split_symbol("ETHBUSD") == ("ETH", "BUSD")
    assert split_symbol("USDT") is None          # 只有计价币，没有标的
    assert split_symbol("BNBBTC") is None        # 默认只认稳定币计价


# --- 加权平均 --------------------------------------------------------------


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
