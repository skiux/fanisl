"""共用的假 Binance：按路径分发的 MockTransport + 真实形状的样本响应。

portfolio / orders / ledger 三组测试共用这一份。各写一份必然会漂移——改了一处样本，
另一处还在验旧形状，而两边都是绿的。

样本按用户的实际持仓形态编：美股永续为主（NVDA/QQQ），现货只留 BNB 与稳定币。
"""

from datetime import datetime, timedelta, timezone

import httpx

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)
BTC = 94180.22
DAY_MS = 86_400_000


def _klines(days: int = 32):
    """日线：[开盘时间, o, h, l, 收盘, ...]。BTC 价逐日不同，用来验"用当天价换算"。"""
    out = []
    for i in range(days):
        ts = int((NOW - timedelta(days=days - 1 - i)).replace(
            hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        close = 90_000 + i * 150          # 90000 → 94650，逐日递增
        out.append([ts, "0", "0", "0", f"{close}", "1", ts + DAY_MS - 1,
                    "0", 0, "0", "0", "0"])
    return out


def _snapshot_vos(total_btc_by_day: dict[str, float]):
    vos = []
    for day, btc in total_btc_by_day.items():
        ts = int(datetime.fromisoformat(day + "T00:00:00+00:00").timestamp() * 1000)
        vos.append({"type": "spot", "updateTime": ts,
                    "data": {"totalAssetOfBtc": f"{btc}", "balances": []}})
    return {"code": 200, "msg": "", "snapshotVos": vos}


def _day(offset: int) -> str:
    return (NOW - timedelta(days=offset)).date().isoformat()


# 现货快照：两天，BTC 计价。第 1 天 0.5 BTC，今天 0.55 BTC。
SPOT_SNAP = _snapshot_vos({_day(1): 0.5, _day(0): 0.55})
MARGIN_SNAP = {"code": 200, "msg": "", "snapshotVos": []}
FUTURES_SNAP = {"code": 200, "msg": "", "snapshotVos": [
    {"type": "futures", "updateTime": int(datetime.fromisoformat(
        _day(1) + "T00:00:00+00:00").timestamp() * 1000),
     "data": {"assets": [{"asset": "USDT", "marginBalance": "8000", "walletBalance": "8000"}]}},
    {"type": "futures", "updateTime": int(datetime.fromisoformat(
        _day(0) + "T00:00:00+00:00").timestamp() * 1000),
     "data": {"assets": [{"asset": "USDT", "marginBalance": "8400", "walletBalance": "8000"}]}},
]}

PRICES = [
    {"symbol": "BTCUSDT", "price": f"{BTC}"},
    {"symbol": "BNBUSDT", "price": "682.15"},
    {"symbol": "NVDAUSDT", "price": "218.42"},
    {"symbol": "QQQUSDT", "price": "618.74"},
    # PAXG 故意不给报价：验"无报价"走 null 而不是 0
]

WALLETS = [
    {"activate": True, "balance": "0.30", "walletName": "Spot"},
    {"activate": True, "balance": "0.09", "walletName": "USDⓈ-M Futures"},
    {"activate": True, "balance": "0.02", "walletName": "Earn"},
    {"activate": False, "balance": "0", "walletName": "Isolated Margin"},
    # 未登记的钱包名：必须保留（丢掉就等于把这块钱从总额抹掉），kind 走 slug
    {"activate": True, "balance": "0.01", "walletName": "Trading Bots"},
]

USER_ASSET = [
    {"asset": "USDT", "free": "8240.16", "locked": "1150", "freeze": "0",
     "withdrawing": "500", "ipoable": "0"},
    {"asset": "BNB", "free": "4.212", "locked": "0", "freeze": "0", "withdrawing": "0"},
    {"asset": "PAXG", "free": "0.00071", "locked": "0", "freeze": "0", "withdrawing": "0"},
    {"asset": "DUST", "free": "0", "locked": "0", "freeze": "0", "withdrawing": "0"},
]

FUT_ACCOUNT = {
    "totalWalletBalance": "8426.13", "totalUnrealizedProfit": "380.45",
    "totalMarginBalance": "8806.58", "totalInitialMargin": "8443.77",
    "totalMaintMargin": "448.17", "availableBalance": "362.81",
    "maxWithdrawAmount": "362.81", "multiAssetsMargin": False,
    "positions": [
        {"symbol": "NVDAUSDT", "positionSide": "BOTH", "positionAmt": "38",
         "notional": "8299.96", "entryPrice": "205.60", "leverage": "3",
         "isolated": False, "unrealizedProfit": "487.16",
         "positionInitialMargin": "2766.65", "maintMargin": "448.17"},
        {"symbol": "QQQUSDT", "positionSide": "BOTH", "positionAmt": "14",
         "notional": "8662.36", "entryPrice": "604.13", "leverage": "3",
         "isolated": False, "unrealizedProfit": "204.54",
         "positionInitialMargin": "2887.45", "maintMargin": "0"},
        # 空仓位：必须被过滤掉，否则界面上会多出几行 0 数量的"持仓"
        {"symbol": "SOLUSDT", "positionSide": "BOTH", "positionAmt": "0",
         "notional": "0", "entryPrice": "0", "leverage": "5", "isolated": False,
         "unrealizedProfit": "0", "positionInitialMargin": "0", "maintMargin": "0"},
    ],
}
FUT_CONFIG = {"dualSidePosition": False, "multiAssetsMargin": False, "feeTier": 0}
FUT_RISK = [
    {"symbol": "NVDAUSDT", "positionSide": "BOTH", "markPrice": "218.42",
     "liquidationPrice": "152.84", "positionAmt": "38"},
    # QQQ 没有强平价（全仓余额充足时 Binance 返回 "0"）→ 距强平走 bracket 兜底
    {"symbol": "QQQUSDT", "positionSide": "BOTH", "markPrice": "618.74",
     "liquidationPrice": "0", "positionAmt": "14"},
]
FUT_ADL = [{"symbol": "NVDAUSDT", "adlQuantile": {"BOTH": 1}},
           {"symbol": "QQQUSDT", "adlQuantile": {"BOTH": 2}}]
BRACKETS = [{"symbol": "QQQUSDT", "brackets": [{"bracket": 1, "maintMarginRatio": 0.02}]}]

EARN_FLEX = {"total": 1, "rows": [
    {"productId": "USDT001", "asset": "USDT", "totalAmount": "6500",
     "latestAnnualPercentageRate": "0.0482", "cumulativeTotalRewards": "128.44",
     "canRedeem": True}]}
EARN_LOCKED = {"total": 1, "rows": [
    {"positionId": 90210, "asset": "BNB", "amount": "2.5", "APY": "0.085",
     "rewardAsset": "BNB", "rewardAmt": "0.0412", "canRedeemEarly": False,
     "deliverDate": int((NOW + timedelta(days=12)).timestamp() * 1000)}]}

MARGIN = {"marginLevel": "1.8134", "totalAssetOfBtc": "0.09994",
          "totalLiabilityOfBtc": "0.05527", "totalNetAssetOfBtc": "0.04467"}

INCOME = [
    {"symbol": "NVDAUSDT", "incomeType": "REALIZED_PNL", "income": "3847.22",
     "asset": "USDT", "time": int(NOW.timestamp() * 1000)},
    {"symbol": "NVDAUSDT", "incomeType": "FUNDING_FEE", "income": "-286.41",
     "asset": "USDT", "time": int(NOW.timestamp() * 1000)},
    {"symbol": "NVDAUSDT", "incomeType": "COMMISSION", "income": "-412.68",
     "asset": "USDT", "time": int(NOW.timestamp() * 1000)},
    {"symbol": "", "incomeType": "REFERRAL_KICKBACK", "income": "18.40",
     "asset": "USDT", "time": int(NOW.timestamp() * 1000)},
    # 划转不是损益。混进来会把真实盈亏算错——这是最容易犯且最难发现的一类错。
    {"symbol": "", "incomeType": "TRANSFER", "income": "5000",
     "asset": "USDT", "time": int(NOW.timestamp() * 1000)},
]

DEPOSITS = [
    {"coin": "USDT", "amount": "3000", "status": 1, "network": "TRX", "txId": "a" * 32,
     "insertTime": int((NOW - timedelta(days=20)).timestamp() * 1000)},
    # 未到账的不能计入：状态 0 = pending
    {"coin": "USDT", "amount": "999", "status": 0, "network": "TRX", "txId": "b" * 32,
     "insertTime": int((NOW - timedelta(days=1)).timestamp() * 1000)},
]
WITHDRAWALS = [
    {"coin": "USDT", "amount": "2000", "status": 6, "transactionFee": "1",
     "network": "TRX", "txId": "c" * 32,
     "applyTime": (NOW - timedelta(days=8)).strftime("%Y-%m-%d %H:%M:%S")},
]

ROUTES = {
    "/api/v3/ticker/price": PRICES,
    "/api/v3/klines": _klines(),
    "/sapi/v1/asset/wallet/balance": WALLETS,
    "/sapi/v3/asset/getUserAsset": USER_ASSET,
    "/fapi/v2/account": FUT_ACCOUNT,
    "/fapi/v1/accountConfig": FUT_CONFIG,
    "/fapi/v2/positionRisk": FUT_RISK,
    "/fapi/v1/adlQuantile": FUT_ADL,
    "/fapi/v1/leverageBracket": BRACKETS,
    "/sapi/v1/simple-earn/flexible/position": EARN_FLEX,
    "/sapi/v1/simple-earn/locked/position": EARN_LOCKED,
    "/sapi/v1/margin/account": MARGIN,
    "/fapi/v1/income": INCOME,
    "/sapi/v1/capital/deposit/hisrec": DEPOSITS,
    "/sapi/v1/capital/withdraw/history": WITHDRAWALS,
    "/api/v3/time": {"serverTime": int(NOW.timestamp() * 1000)},
    "/fapi/v1/time": {"serverTime": int(NOW.timestamp() * 1000)},
}


# --- 委托页的样本 ---------------------------------------------------------

SPOT_OPEN = [
    # 现货限价买单：orderListId 为 -1 表示"不属于任何 OCO 组"，照搬会变成假的组号
    {"symbol": "BNBUSDT", "orderId": 4100001, "orderListId": -1, "price": "640.00",
     "origQty": "2.0", "executedQty": "0.5", "cummulativeQuoteQty": "320",
     "status": "PARTIALLY_FILLED", "timeInForce": "GTC", "type": "LIMIT", "side": "BUY",
     "stopPrice": "0.00", "time": int((NOW - timedelta(days=2)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(hours=6)).timestamp() * 1000)},
    # OCO 的两条腿：一条只挂单、一条止损限价，共用同一个 orderListId
    {"symbol": "BNBUSDT", "orderId": 4100002, "orderListId": 77, "price": "760.00",
     "origQty": "1.0", "executedQty": "0", "status": "NEW", "timeInForce": "GTC",
     "type": "LIMIT_MAKER", "side": "SELL", "stopPrice": "0.00",
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=1)).timestamp() * 1000)},
    {"symbol": "BNBUSDT", "orderId": 4100003, "orderListId": 77, "price": "600.00",
     "origQty": "1.0", "executedQty": "0", "status": "NEW", "timeInForce": "GTC",
     "type": "STOP_LOSS_LIMIT", "side": "SELL", "stopPrice": "610.00",
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=1)).timestamp() * 1000)},
    # 现货止损**市价**：STOP_LOSS 与 STOP_LOSS_LIMIT 的名字很容易读反
    {"symbol": "BNBUSDT", "orderId": 4100004, "orderListId": -1, "price": "0.00",
     "origQty": "0.5", "executedQty": "0", "status": "NEW", "timeInForce": "GTC",
     "type": "STOP_LOSS", "side": "SELL", "stopPrice": "580.00",
     "time": int((NOW - timedelta(hours=3)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(hours=3)).timestamp() * 1000)},
]

FUT_OPEN = [
    # 止盈市价，全平仓位，按标记价触发。**已触发的单 type 会变成 MARKET**，
    # origType 才是下单时的意图——读错这里，止盈单在成交那刻会显示成"市价单"。
    {"orderId": 5200001, "symbol": "NVDAUSDT", "status": "NEW", "price": "0",
     "avgPrice": "0", "origQty": "38", "executedQty": "0", "timeInForce": "GTE_GTC",
     "type": "MARKET", "origType": "TAKE_PROFIT_MARKET", "reduceOnly": False,
     "closePosition": True, "side": "SELL", "positionSide": "BOTH",
     "stopPrice": "260.00", "workingType": "MARK_PRICE", "priceProtect": True,
     "time": int((NOW - timedelta(days=3)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=3)).timestamp() * 1000)},
    {"orderId": 5200002, "symbol": "NVDAUSDT", "status": "NEW", "price": "0",
     "origQty": "38", "executedQty": "0", "timeInForce": "GTE_GTC",
     "type": "STOP_MARKET", "origType": "STOP_MARKET", "reduceOnly": False,
     "closePosition": True, "side": "SELL", "positionSide": "BOTH",
     "stopPrice": "190.00", "workingType": "MARK_PRICE",
     "time": int((NOW - timedelta(days=3)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=3)).timestamp() * 1000)},
    # 追踪止损：激活价 + 回调率
    {"orderId": 5200003, "symbol": "QQQUSDT", "status": "NEW", "price": "0",
     "origQty": "14", "executedQty": "0", "timeInForce": "GTC",
     "type": "TRAILING_STOP_MARKET", "origType": "TRAILING_STOP_MARKET",
     "reduceOnly": True, "closePosition": False, "side": "SELL", "positionSide": "BOTH",
     "stopPrice": "0", "activatePrice": "640.00", "priceRate": "0.018",
     "workingType": "MARK_PRICE",
     "time": int((NOW - timedelta(hours=12)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(hours=12)).timestamp() * 1000)},
]

MARGIN_OPEN = [
    {"symbol": "BNBUSDT", "orderId": 6300001, "orderListId": -1, "price": "620.00",
     "origQty": "1.0", "executedQty": "0", "status": "NEW", "timeInForce": "GTC",
     "type": "LIMIT", "side": "BUY", "stopPrice": "0.00", "isIsolated": False,
     "time": int((NOW - timedelta(days=5)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=5)).timestamp() * 1000)},
]

ORDER_LISTS = [
    {"orderListId": 77, "contingencyType": "OCO", "listStatusType": "EXEC_STARTED",
     "listOrderStatus": "EXECUTING", "listClientOrderId": "oco-bnb-1",
     "transactionTime": int((NOW - timedelta(days=1)).timestamp() * 1000),
     "symbol": "BNBUSDT",
     "orders": [{"symbol": "BNBUSDT", "orderId": 4100002, "clientOrderId": "a"},
                {"symbol": "BNBUSDT", "orderId": 4100003, "clientOrderId": "b"}]},
]

ALGO_OPEN = {"total": 1, "orders": [
    {"algoId": 880001, "symbol": "QQQUSDT", "side": "BUY", "positionSide": "BOTH",
     "totalQty": "10", "executedQty": "2", "executedAmt": "1237.48", "avgPrice": "618.74",
     "algoType": "TWAP", "algoStatus": "WORKING", "urgency": "LOW",
     "bookTime": int((NOW - timedelta(hours=2)).timestamp() * 1000),
     "endTime": int((NOW + timedelta(hours=2)).timestamp() * 1000)}]}

FUT_ALL_ORDERS = [
    {"orderId": 5100001, "symbol": "NVDAUSDT", "status": "FILLED", "price": "205.60",
     "avgPrice": "205.60", "origQty": "38", "executedQty": "38", "timeInForce": "GTC",
     "type": "LIMIT", "origType": "LIMIT", "reduceOnly": False, "closePosition": False,
     "side": "BUY", "positionSide": "BOTH", "stopPrice": "0",
     "time": int((NOW - timedelta(days=5)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=5)).timestamp() * 1000)},
    {"orderId": 5100002, "symbol": "NVDAUSDT", "status": "CANCELED", "price": "230.00",
     "origQty": "10", "executedQty": "0", "timeInForce": "GTX", "type": "LIMIT",
     "origType": "LIMIT", "reduceOnly": False, "closePosition": False,
     "side": "SELL", "positionSide": "BOTH", "stopPrice": "0",
     "time": int((NOW - timedelta(days=4)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(days=4)).timestamp() * 1000)},
]

FUT_USER_TRADES = [
    {"id": 820001, "orderId": 5100001, "symbol": "NVDAUSDT", "side": "BUY",
     "price": "205.60", "qty": "38", "quoteQty": "7812.80", "commission": "3.13",
     "commissionAsset": "USDT", "maker": False, "realizedPnl": "0",
     "time": int((NOW - timedelta(days=5)).timestamp() * 1000)},
    {"id": 820002, "orderId": 5100003, "symbol": "NVDAUSDT", "side": "SELL",
     "price": "218.00", "qty": "5", "quoteQty": "1090.00", "commission": "0.44",
     "commissionAsset": "USDT", "maker": True, "realizedPnl": "62.00",
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000)},
]

SPOT_ALL_ORDERS = [
    {"symbol": "BNBUSDT", "orderId": 4000001, "orderListId": -1, "price": "650.00",
     "origQty": "1.0", "executedQty": "1.0", "status": "FILLED", "timeInForce": "GTC",
     "type": "LIMIT", "side": "BUY", "stopPrice": "0.00",
     "time": int((NOW - timedelta(hours=10)).timestamp() * 1000),
     "updateTime": int((NOW - timedelta(hours=10)).timestamp() * 1000)},
]

SPOT_MY_TRADES = [
    # 现货没有 side 字段，用 isBuyer；也没有 realizedPnl（现货成交不结算盈亏）
    {"id": 910001, "orderId": 4000001, "symbol": "BNBUSDT", "price": "650.00",
     "qty": "1.0", "quoteQty": "650.00", "commission": "0.00075",
     "commissionAsset": "BNB", "isBuyer": True, "isMaker": True,
     "time": int((NOW - timedelta(hours=10)).timestamp() * 1000)},
]

ROUTES.update({
    "/api/v3/openOrders": SPOT_OPEN,
    "/fapi/v1/openOrders": FUT_OPEN,
    "/sapi/v1/margin/openOrders": MARGIN_OPEN,
    "/api/v3/openOrderList": ORDER_LISTS,
    "/sapi/v1/algo/futures/openOrders": ALGO_OPEN,
    "/fapi/v1/allOrders": FUT_ALL_ORDERS,
    "/fapi/v1/userTrades": FUT_USER_TRADES,
    "/api/v3/allOrders": SPOT_ALL_ORDERS,
    "/api/v3/myTrades": SPOT_MY_TRADES,
})


# --- 流水页的样本 ---------------------------------------------------------

LEDGER_DEPOSITS = [
    {"coin": "USDT", "amount": "3000", "status": 1, "network": "TRX", "txId": "d" * 32,
     "insertTime": int((NOW - timedelta(days=4)).timestamp() * 1000)},
    {"coin": "USDT", "amount": "500", "status": 0, "network": "TRX", "txId": "e" * 32,
     "insertTime": int((NOW - timedelta(days=1)).timestamp() * 1000)},
]

LEDGER_WITHDRAWALS = [
    # applyTime 是**字符串**，不是毫秒时间戳。当成毫秒解析会得到 1970 年，
    # 整段提现记录排到时间线最底下、日期还全错。
    {"id": "w1", "coin": "USDT", "amount": "2000", "transactionFee": "1", "status": 6,
     "network": "TRX", "txId": "f" * 32,
     "applyTime": (NOW - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")},
]

LEDGER_INCOME = [
    {"symbol": "NVDAUSDT", "incomeType": "FUNDING_FEE", "income": "-3.18",
     "asset": "USDT", "tranId": 7001,
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000)},
    {"symbol": "NVDAUSDT", "incomeType": "REALIZED_PNL", "income": "203.88",
     "asset": "USDT", "tranId": 7002,
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000)},
    {"symbol": "", "incomeType": "TRANSFER", "income": "1000", "asset": "USDT",
     "tranId": 7003, "time": int((NOW - timedelta(days=2)).timestamp() * 1000)},
]

LEDGER_TRANSFERS = {
    "MAIN_UMFUTURE": {"total": 1, "rows": [
        {"asset": "USDT", "amount": "800", "type": "MAIN_UMFUTURE", "status": "CONFIRMED",
         "tranId": 8001, "timestamp": int((NOW - timedelta(days=2)).timestamp() * 1000)}]},
}

LEDGER_EARN_FLEX = {"total": 1, "rows": [
    {"asset": "USDT", "rewards": "0.86", "projectId": "USDT001", "type": "REWARDS",
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000)}]}
LEDGER_EARN_LOCKED = {"total": 1, "rows": [
    {"positionId": 90210, "asset": "BNB", "amount": "0.0012", "lockPeriod": "30",
     "time": int((NOW - timedelta(days=1)).timestamp() * 1000)}]}

# 官方把这个字段拼错成 interestAccuredTime（少个 c），照着写才取得到
LEDGER_INTEREST = {"total": 1, "rows": [
    {"txId": 9001, "interestAccuredTime": int((NOW - timedelta(days=1)).timestamp() * 1000),
     "asset": "USDT", "principal": "5000", "interest": "1.04",
     "interestRate": "0.0002", "type": "PERIODIC"}]}

# 闪兑返回的是 list 不是 rows
LEDGER_CONVERT = {"list": [
    {"quoteId": "q1", "orderId": 10001, "orderStatus": "SUCCESS",
     "fromAsset": "USDT", "fromAmount": "1000", "toAsset": "BNB", "toAmount": "1.465",
     "ratio": "0.001465", "inverseRatio": "682.15",
     "createTime": int((NOW - timedelta(days=2)).timestamp() * 1000)},
    {"quoteId": "q2", "orderId": 10002, "orderStatus": "FAILED",
     "fromAsset": "USDT", "fromAmount": "50", "toAsset": "BNB", "toAmount": "0",
     "createTime": int((NOW - timedelta(days=2)).timestamp() * 1000)},
], "startTime": 0, "endTime": 0, "limit": 100, "moreData": False}

# 小额兑换的壳又不一样：userAssetDribblets
LEDGER_DUST = {"total": 1, "userAssetDribblets": [
    {"operateTime": int((NOW - timedelta(days=5)).timestamp() * 1000),
     "totalTransferedAmount": "0.0781", "totalServiceChargeAmount": "0.0016",
     "transId": 11001,
     "userAssetDribbletDetails": [
         {"transId": 11001, "serviceChargeAmount": "0.0008", "amount": "12",
          "operateTime": int((NOW - timedelta(days=5)).timestamp() * 1000),
          "transferedAmount": "0.039", "fromAsset": "ADA"},
         {"transId": 11001, "serviceChargeAmount": "0.0008", "amount": "3",
          "operateTime": int((NOW - timedelta(days=5)).timestamp() * 1000),
          "transferedAmount": "0.039", "fromAsset": "DOT"}]}]}

ROUTES.update({
    "/sapi/v1/simple-earn/flexible/history/rewardsRecord": LEDGER_EARN_FLEX,
    "/sapi/v1/simple-earn/locked/history/rewardsRecord": LEDGER_EARN_LOCKED,
    "/sapi/v1/margin/interestHistory": LEDGER_INTEREST,
    "/sapi/v1/convert/tradeFlow": LEDGER_CONVERT,
    "/sapi/v1/asset/dribblet": LEDGER_DUST,
})

# 流水页与资产页共用充提、收支两个端点，但窗口不同——用专门的样本覆盖
LEDGER_ROUTES = {
    "/sapi/v1/capital/deposit/hisrec": LEDGER_DEPOSITS,
    "/sapi/v1/capital/withdraw/history": LEDGER_WITHDRAWALS,
    "/fapi/v1/income": LEDGER_INCOME,
}


def make_transport(*, fail: dict[str, int] | None = None, calls: list | None = None,
                   ledger: bool = False):
    """按路径分发的假 Binance。

    fail 把某些路径映射成 HTTP 状态码。ledger=True 时充提/收支三个端点换成流水页的样本
    （两页共用端点但窗口不同，样本也该不同）。
    """
    fail = fail or {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if calls is not None:
            calls.append(path)
        for prefix, status in fail.items():
            if path.startswith(prefix):
                return httpx.Response(status, json={"code": -1000, "msg": "mocked failure"})
        if path == "/sapi/v1/accountSnapshot":
            kind = dict(request.url.params).get("type", "SPOT")
            return httpx.Response(200, json={"SPOT": SPOT_SNAP, "MARGIN": MARGIN_SNAP,
                                             "FUTURES": FUTURES_SNAP}[kind])
        if path == "/sapi/v1/asset/transfer":
            kind = dict(request.url.params).get("type", "")
            return httpx.Response(200, json=LEDGER_TRANSFERS.get(
                kind, {"total": 0, "rows": []}))
        if ledger and path in LEDGER_ROUTES:
            return httpx.Response(200, json=LEDGER_ROUTES[path])
        if path in ROUTES:
            return httpx.Response(200, json=ROUTES[path])
        return httpx.Response(404, json={"code": -1121, "msg": f"no mock for {path}"})

    return httpx.MockTransport(handler)
