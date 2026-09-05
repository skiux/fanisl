"""逐日盈亏：按当天的持仓量与当天的收盘价算。

纯逻辑，不碰网络也不碰库——口径对不对在这里定死。
"""

from datetime import datetime, timezone

import pytest

from analyzer.binance.dailypnl import collect_flows, daily_spot_pnl, flow

NOW = datetime(2026, 9, 5, 12, tzinfo=timezone.utc)
CLOSES = {"BNB": {"2026-09-02": 600.0, "2026-09-03": 610.0,
                  "2026-09-04": 605.0, "2026-09-05": 620.0}}


def run(held, flows=(), closes=None, days=3):
    return daily_spot_pnl(held, closes or CLOSES, flows, days=days, now=NOW)


# --- 口径 ------------------------------------------------------------------

def test_holding_alone_earns_the_price_move():
    """不成交也在赚钱亏钱——这是换掉"只算结算"的全部理由。"""
    assert run({"BNB": 2.0})["days"] == {
        "2026-09-03": pytest.approx(20.0),    # 2 × (610 − 600)
        "2026-09-04": pytest.approx(-10.0),   # 2 × (605 − 610)
        "2026-09-05": pytest.approx(30.0),    # 2 × (620 − 605)
    }


def test_a_buy_only_earns_from_its_own_fill_price():
    """当天买的那部分从成交价算起，不是从昨收算起。

    09-04 收在 605、买入价也是 605，所以新买的 1 个当天贡献 0；
    原有的 2 个照 610→605 算，一共 −10。
    """
    out = run({"BNB": 3.0}, [flow("2026-09-04", "BNB", 1.0, 605.0)])
    assert out["days"]["2026-09-04"] == pytest.approx(-10.0)
    assert out["days"]["2026-09-05"] == pytest.approx(45.0)   # 3 × 15


def test_a_buy_below_the_close_earns_the_difference_that_day():
    out = run({"BNB": 3.0}, [flow("2026-09-04", "BNB", 1.0, 600.0)])
    # 原有 2 个 × (−5) + 新买 1 个 × (605 − 600)
    assert out["days"]["2026-09-04"] == pytest.approx(-10.0 + 5.0)


def test_a_deposit_is_not_profit():
    """钱进来不是赚的。充值当天只算原有持仓的涨跌。"""
    out = run({"BNB": 3.0}, [flow("2026-09-03", "BNB", 1.0, None)])
    assert out["days"]["2026-09-03"] == pytest.approx(20.0)   # 只有原来的 2 个
    assert out["days"]["2026-09-04"] == pytest.approx(-15.0)  # 之后按 3 个算


def test_an_earn_reward_is_all_profit():
    """理财派息是白得的，单位成本 0，全额算收益。"""
    out = run({"BNB": 2.1}, [flow("2026-09-03", "BNB", 0.1, 0.0)])
    assert out["days"]["2026-09-03"] == pytest.approx(2.0 * 10.0 + 0.1 * 610.0)


def test_a_fee_paid_in_bnb_is_a_loss():
    """手续费用 BNB 抵扣：币出去了、什么都没换回来，全额算亏。"""
    out = run({"BNB": 2.0}, [flow("2026-09-04", "BNB", -0.01, 0.0)])
    # 当天开盘时手里是 2.01 个，跌 5 块 → −10.05；再扣掉出去的 0.01 个 × 605 → −6.05
    assert out["days"]["2026-09-04"] == pytest.approx(2.01 * -5.0 - 0.01 * 605.0)


# --- 算不出来的时候 --------------------------------------------------------

def test_rolling_back_below_zero_reports_the_day_empty():
    """回滚出负数 = 有一类进出没被覆盖到（多半是 90 天以外的充值）。

    夹到 0 只会把误差往前推，报一个错的数比留空更糟。
    """
    out = run({"BNB": 1.0}, [flow("2026-09-04", "BNB", 5.0, 605.0)])
    assert out["unbalanced_assets"] == ["BNB"]
    assert out["days"]["2026-09-03"] is None and out["days"]["2026-09-04"] is None
    assert out["days"]["2026-09-05"] == pytest.approx(15.0)   # 今天不受影响


def test_a_coin_with_no_quote_is_left_out_not_blanking_every_day():
    """没有报价对的币整个不参与，与净值同一个口径。

    曾经写成"任一持有的币缺价 ⇒ 那天报空"，结果一个几分钱的尘埃仓位
    （0.00071 PAXG，没有 USDT 对）把整张 90 天日历抹成了空白。
    """
    out = run({"BNB": 2.0, "PAXG": 0.00071})
    assert out["unpriced_assets"] == ["PAXG"]
    assert out["days"]["2026-09-05"] == pytest.approx(30.0)


def test_no_prices_at_all_is_empty_not_zero():
    """行情整个取不到时该是空。0 会被读成"今天没赚没亏"。"""
    out = daily_spot_pnl({"BNB": 2.0}, {}, [], days=3, now=NOW)
    assert set(out["days"].values()) == {None}


def test_an_account_with_only_stablecoins_really_is_zero():
    """只有 USDT 的账户，0 是真的——这条与上一条的区别不能糊掉。"""
    out = daily_spot_pnl({"USDT": 5000.0}, {}, [], days=3, now=NOW)
    assert set(out["days"].values()) == {0.0}


def test_stablecoins_never_participate():
    out = run({"BNB": 2.0, "USDT": 5000.0})
    assert all(row["asset"] != "USDT" for row in out["today_by_asset"])


# --- 进出清单 --------------------------------------------------------------

def test_trade_produces_both_legs_and_the_fee():
    flows = collect_flows(trades=[{
        "symbol": "BNBUSDT", "isBuyer": True, "qty": "2", "price": "600",
        "time": 1_757_000_000_000, "commission": "0.001", "commissionAsset": "BNB",
    }])
    by = {(f["asset"], f["unit_usd"]): f["dq"] for f in flows}
    assert by[("BNB", 600.0)] == pytest.approx(2.0)      # 买进 2 个，单位成本是成交价
    assert by[("USDT", 1.0)] == pytest.approx(-1200.0)   # 付出去的计价币
    assert by[("BNB", 0.0)] == pytest.approx(-0.001)     # 手续费，全额算亏


def test_pending_deposits_and_unfinished_withdrawals_are_ignored():
    """挂起中的充值还没进余额，算进来会让那天凭空多一笔。"""
    flows = collect_flows(
        deposits=[{"coin": "BNB", "amount": "1", "insertTime": 1_757_000_000_000,
                   "status": 0}],
        withdrawals=[{"coin": "BNB", "amount": "1", "transactionFee": "0.01",
                      "applyTime": "2026-09-04 10:00:00", "status": 2}])
    assert flows == []


def test_futures_income_moves_quantity_but_not_spot_pnl():
    """合约结算的损益已经在"当日结算"那半边算过一次，这里只认数量变化。"""
    flows = collect_flows(income=[
        {"incomeType": "COMMISSION", "income": "-0.01", "asset": "BNB",
         "time": 1_757_000_000_000},
        {"incomeType": "TRANSFER", "income": "500", "asset": "USDT",
         "time": 1_757_000_000_000},
    ])
    assert len(flows) == 1
    assert flows[0]["asset"] == "BNB" and flows[0]["unit_usd"] is None


def test_convert_is_not_profit():
    """按市价换币，两头都按当日收盘计价，当天贡献 0。"""
    flows = collect_flows(convert={"list": [{
        "orderStatus": "SUCCESS", "createTime": 1_757_000_000_000,
        "fromAsset": "BNB", "fromAmount": "1", "toAsset": "ETH", "toAmount": "0.2",
    }]})
    assert {f["asset"]: f["dq"] for f in flows} == {"BNB": -1.0, "ETH": 0.2}
    assert all(f["unit_usd"] is None for f in flows)
