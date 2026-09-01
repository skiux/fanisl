"""/portfolio 的组装：Binance 原始响应 → console 契约。

这一组要守住的是映射本身——字段名、单位（BTC 计价还是 USD）、以及"取不到"与"是 0"
的区别。这些错了界面上看着一切正常，数字却是错的，比崩掉更难发现。

假 Binance 与样本在 tests/binance_mock.py，三组测试共用。
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from analyzer.binance.cache import SourceCache
from analyzer.binance.client import BinanceClient
from analyzer.binance.portfolio import build_portfolio

from binance_mock import BTC, NOW, _day, _klines, make_transport


@pytest.fixture
def cache(pool):
    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_cache")
    return SourceCache(pool)


def build(cache, *, fail=None, calls=None, force=True):
    client = BinanceClient("k", "s", client=httpx.Client(transport=make_transport(
        fail=fail, calls=calls)))
    try:
        return build_portfolio(client, cache, force=force, now=NOW)
    finally:
        client.close()


# --- 正常路径 -------------------------------------------------------------

def test_snapshot_shape_matches_contract(cache):
    snap = build(cache)
    assert set(snap) == {"as_of", "base_currency", "sources", "totals", "wallets", "spot",
                         "futures", "earn", "margin", "income", "transfers",
                         "equity_curve", "attribution"}
    assert snap["base_currency"] == "USD"
    assert {s["key"] for s in snap["sources"]} == {
        "prices", "wallets", "spot", "futures", "brackets", "earn", "margin",
        "income", "transfers", "snapshots"}
    assert all(s["status"] == "ok" for s in snap["sources"])


def test_wallets_are_btc_denominated_and_nothing_is_dropped(cache):
    snap = build(cache)
    kinds = {w["kind"]: w for w in snap["wallets"]}
    assert kinds["spot"]["btc_valuation"] == 0.30
    assert kinds["spot"]["value_usd"] == pytest.approx(0.30 * BTC)
    # 未登记的钱包名不能丢——丢了就等于把这块钱从净值里抹掉
    assert "trading_bots" in kinds
    assert kinds["isolated_margin"]["activate"] is False


def test_equity_excludes_deactivated_wallets(cache):
    snap = build(cache)
    active = sum(w["value_usd"] for w in snap["wallets"] if w["activate"])
    assert snap["totals"]["equity_usd"] == pytest.approx(active)


def test_spot_keeps_four_lock_states_and_drops_zero_balances(cache):
    snap = build(cache)
    by = {row["asset"]: row for row in snap["spot"]}
    usdt = by["USDT"]
    assert (usdt["free"], usdt["locked"], usdt["withdrawing"]) == (8240.16, 1150.0, 500.0)
    assert usdt["total"] == pytest.approx(8240.16 + 1150 + 500)
    assert "DUST" not in by          # 余额为 0 的不列
    # 没有报价对的资产：value_usd 必须是 null，**不是 0**——0 是一个有效余额
    assert by["PAXG"]["price_usd"] is None and by["PAXG"]["value_usd"] is None


def test_futures_positions_pull_mark_and_liq_from_position_risk(cache):
    snap = build(cache)
    positions = {p["symbol"]: p for p in snap["futures"]["positions"]}
    assert set(positions) == {"NVDAUSDT", "QQQUSDT"}   # 0 数量的被过滤
    nvda = positions["NVDAUSDT"]
    assert nvda["mark_price"] == 218.42          # 只有 positionRisk 有这个
    assert nvda["liquidation_price"] == 152.84
    assert nvda["liq_distance"] == pytest.approx((218.42 - 152.84) / 218.42)
    assert nvda["adl_quantile"] == 1
    assert nvda["position_amt"] == 38


def test_liq_distance_falls_back_to_bracket_when_exchange_gives_none(cache):
    snap = build(cache)
    qqq = {p["symbol"]: p for p in snap["futures"]["positions"]}["QQQUSDT"]
    assert qqq["liquidation_price"] is None       # 交易所给的是 "0"
    assert qqq["liq_distance"] == pytest.approx(1 / 3 - 0.02)


def test_margin_ratio_and_margin_account_conversion(cache):
    snap = build(cache)
    assert snap["futures"]["margin_ratio"] == pytest.approx(448.17 / 8806.58)
    assert snap["margin"]["margin_level"] == pytest.approx(1.8134)
    assert snap["margin"]["total_asset_usd"] == pytest.approx(0.09994 * BTC)


def test_income_excludes_transfers(cache):
    """TRANSFER 混进损益是最容易犯、最难发现的一类错：净值对得上，盈亏全错。"""
    snap = build(cache)
    assert snap["income"]["realized_pnl"] == pytest.approx(3847.22)
    assert snap["income"]["funding_fee"] == pytest.approx(-286.41)
    assert snap["income"]["referral_kickback"] == pytest.approx(18.40)
    assert snap["income"]["other"] == 0.0        # 5000 的 TRANSFER 没被算进任何一项


def test_transfers_only_count_settled(cache):
    snap = build(cache)
    assert snap["transfers"]["deposits_usd"] == pytest.approx(3000.0)
    assert snap["transfers"]["deposit_count"] == 1      # pending 那笔不算
    assert snap["transfers"]["withdrawals_usd"] == pytest.approx(2000.0)
    assert snap["transfers"]["net_usd"] == pytest.approx(1000.0)


def test_equity_curve_uses_each_days_btc_close(cache):
    """拿今天的 BTC 价乘 30 天前的余额，画出来的是 BTC 的走势不是账户的。"""
    snap = build(cache)
    curve = {row["date"]: row["equity_usd"] for row in snap["equity_curve"]}
    closes = {datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).date().isoformat(): float(k[4])
              for k in _klines()}
    # 现货 BTC 计价 × 当天收盘 + 合约 USDT 余额
    assert curve[_day(1)] == pytest.approx(0.5 * closes[_day(1)] + 8000)
    assert curve[_day(0)] == pytest.approx(0.55 * closes[_day(0)] + 8400)
    assert closes[_day(1)] != closes[_day(0)]     # 两天价格确实不同，断言才有意义


def test_attribution_identity_closes(cache):
    snap = build(cache)
    a = snap["attribution"]
    total = (a["net_transfer"] + a["realized_pnl"] + a["unrealized_delta"]
             + a["funding_fee"] + a["commission"])
    assert a["opening_equity"] + total == pytest.approx(a["closing_equity"])
    assert a["true_pnl"] == pytest.approx(a["closing_equity"] - a["opening_equity"]
                                          - a["net_transfer"])


# --- 降级 -----------------------------------------------------------------

def test_fapi_451_kills_futures_but_not_spot(cache):
    """451 常常只打在 fapi 上。现货、理财、钱包必须照常。"""
    snap = build(cache, fail={"/fapi": 451})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["futures"]["status"] == "unreachable"
    assert "451" in states["futures"]["detail"]
    assert states["income"]["status"] == "unreachable"
    assert states["spot"]["status"] == "ok" and states["wallets"]["status"] == "ok"

    assert snap["futures"] is None
    assert snap["income"] is None
    assert snap["attribution"] is None      # 缺收支流水，恒等式不闭合，整块留空
    assert snap["spot"] and snap["wallets"]
    assert snap["totals"]["gross_exposure_ratio"] is None


def test_unauthorized_is_reported_separately_from_unreachable(cache):
    """"key 权限不对"和"网络不通"的处置完全不同，不能混成一句失败。"""
    snap = build(cache, fail={"/sapi/v1/margin/account": 401})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["margin"]["status"] == "unauthorized"
    assert snap["margin"] is None


def test_stale_cache_is_served_with_the_real_failure_reason(cache):
    fresh = build(cache, force=True)
    assert fresh["futures"] is not None

    degraded = build(cache, fail={"/fapi": 451}, force=True)
    states = {s["key"]: s for s in degraded["sources"]}
    # 有旧数据就回落到旧数据，但状态与时刻都如实反映"这是旧的"
    assert degraded["futures"] is not None
    assert states["futures"]["status"] == "unreachable"
    assert states["futures"]["as_of"] == {s["key"]: s for s in fresh["sources"]}["futures"]["as_of"]


def test_cache_prevents_refetching(cache):
    calls: list[str] = []
    build(cache, calls=calls, force=True)
    first = len(calls)
    build(cache, calls=calls, force=False)
    # 第二次全部命中缓存，只可能有对时请求
    extra = [p for p in calls[first:] if not p.endswith("/time")]
    assert extra == [], f"缓存没生效，又打了 {extra}"


def test_missing_prices_degrade_to_null_not_zero(cache):
    snap = build(cache, fail={"/api/v3/ticker/price": 500})
    states = {s["key"]: s for s in snap["sources"]}
    assert states["prices"]["status"] == "unreachable"
    by = {row["asset"]: row for row in snap["spot"]}
    # 稳定币不依赖行情端点，$1 仍然成立；其余一律留空而不是记 0
    assert by["USDT"]["price_usd"] == 1.0
    assert by["BNB"]["value_usd"] is None and by["PAXG"]["value_usd"] is None
    # 钱包余额是 BTC 计价的，没有 BTCUSDT 就换不出 USD
    assert all(w["value_usd"] is None for w in snap["wallets"])
    assert snap["totals"] is None            # 净值算不出来就整块留空
    assert snap["attribution"] is None


def test_as_of_reports_the_oldest_successful_source(cache):
    """整页的可信时刻由最落后的那块决定，报最新的会让页面显得比实际新鲜。"""
    snap = build(cache)
    oldest = min(s["as_of"] for s in snap["sources"] if s["status"] == "ok")
    assert snap["as_of"] == oldest


def test_margin_level_sentinel_becomes_null(cache):
    """无负债时 Binance 返回 999 这类哨兵值，照搬会在界面上显示成荒谬的风险率。"""
    import analyzer.binance.portfolio as mod
    assert mod._margin({"marginLevel": "999", "totalAssetOfBtc": "1",
                        "totalLiabilityOfBtc": "0", "totalNetAssetOfBtc": "1"},
                       BTC)["margin_level"] is None


def test_missing_credentials_report_unauthorized_not_crash(cache):
    """还没配 key 时，服务照常起、接口照常回——每个来源记 unauthorized。

    启动阶段因为没配 key 就崩，会让"部署完了去填 key"这个正常顺序变成不可能。
    """
    client = BinanceClient("", "", client=httpx.Client(transport=make_transport()))
    try:
        snap = build_portfolio(client, cache, force=True, now=NOW)
    finally:
        client.close()
    states = {s["key"]: s for s in snap["sources"]}
    # 行情是公开端点，没有 key 也能取——它照常 ok
    assert states["prices"]["status"] == "ok"
    private = [k for k in states if k != "prices"]
    assert all(states[k]["status"] == "unauthorized" for k in private)
    assert all("未配置" in states[k]["detail"] for k in private)
    assert snap["totals"] is None and snap["futures"] is None
    assert snap["spot"] == [] and snap["equity_curve"] == []


def test_force_does_not_punch_through_expensive_sources(cache):
    """日快照单次权重 2400，一分钟预算 6000。连点"重新取数"不能把它打空。"""
    calls: list[str] = []
    build(cache, calls=calls, force=True)
    first = len(calls)
    build(cache, calls=calls, force=True)
    again = [p for p in calls[first:] if not p.endswith("/time")]
    assert "/sapi/v1/accountSnapshot" not in again
    assert "/fapi/v1/leverageBracket" not in again
    assert "/fapi/v2/account" in again      # 便宜的来源照常强刷
