"""/portfolio 的组装：Binance 原始响应 → console 契约。

这一组要守住的是映射本身——字段名、单位（BTC 计价还是 USD）、以及"取不到"与"是 0"
的区别。这些错了界面上看着一切正常，数字却是错的，比崩掉更难发现。

假 Binance 与样本在 tests/binance_mock.py，三组测试共用。
"""

from datetime import datetime, timedelta, timezone

import pathlib
import re

import httpx
import pytest

from analyzer.binance.cache import SourceCache
from analyzer.binance.client import BinanceClient
from analyzer.binance.portfolio import build_portfolio

from binance_mock import BTC, NOW, PREV_CLOSE_RATIO, _day, make_transport


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
                         "futures", "earn", "margin", "income", "transfers", "pnl"}
    assert snap["base_currency"] == "USD"
    assert {s["key"] for s in snap["sources"]} == {
        "prices", "wallets", "spot", "futures", "earn", "margin",
        "income", "transfers"}
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


def test_no_liquidation_price_means_no_distance(cache):
    """没有强平价就没有"距强平"，不拿杠杆倒推一个。

    这里曾经用 1/杠杆 − 维持保证金率兜底。那是逐仓的公式，而交易所恰恰在**全仓且
    余额充足**时才把 liquidationPrice 返回成 "0"——最安全的仓位会被算出最紧的数，
    且这个数只是 1/杠杆，价格怎么动都不变。页面上于是出现"强平价 —，距强平 9.5%"。
    """
    snap = build(cache)
    qqq = {p["symbol"]: p for p in snap["futures"]["positions"]}["QQQUSDT"]
    assert qqq["liquidation_price"] is None       # 交易所给的是 "0"
    assert qqq["liq_distance"] is None


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
    # 合约整块取不到时，盈亏里合约那两项留空
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
    # 钱包余额是 BTC 计价的，没有 BTCUSDT 就换不出 USD。
    # 先断言非空：wallets 为空时 all() 恒真，这条会空跑通过。
    assert snap["wallets"]
    assert all(w["value_usd"] is None for w in snap["wallets"])
    assert snap["totals"] is None            # 净值算不出来就整块留空
    # 合约损益结在 USDT 上，稳定币不依赖行情端点，这一项照样算得出来
    assert snap["pnl"]["realized"]["futures_usd"] == pytest.approx(3847.22)
    # 现货那半边要行情，没有就留空而不是记 0——"今天没涨没跌"与"取不到"是两件事
    assert snap["pnl"]["today"]["spot_usd"] is None
    assert snap["pnl"]["today"]["total_usd"] is None


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
    assert snap["spot"] == []


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


def test_page_as_of_ignores_daily_cadence_sources(cache):
    """页面时刻不该被日快照/杠杆档位的年龄拖垮。

    那两样是**有意长缓存**的日频数据（accountSnapshot 单次权重 2400，三种类型就超
    一分钟预算）。把它们算进页面时刻的话，整页会被标成"已过期"，界面上还挂一句
    "下面全部数字来自 X 的快照，不是当前余额"——而余额其实是 60 秒内的，那句话是假的。
    2026-09-02 线上就是这么显示成"快一个小时前的数据"的。
    """
    snap = build(cache)
    states = {s["key"]: s for s in snap["sources"]}

    # 把两个日频来源的缓存时刻改老，但**仍在各自 TTL 之内**（快照 6 小时、档位 24 小时），
    # 否则它们会被重新取、时间戳又变新，这条测试就验不到东西了
    with cache.pool.connection() as conn:
        conn.execute("UPDATE binance_cache SET fetched_at = now() - interval '3 hours' "
                     "WHERE source_key LIKE 'trades.%'")
    aged = build(cache, force=False)
    aged_states = {s["key"]: s for s in aged["sources"]}

    # 页面时刻跟着**会变的**那些走，不被长缓存的成交历史拖老
    assert aged["as_of"] == min(
        s["as_of"] for s in aged["sources"]
        if s["key"] in {"prices", "wallets", "spot", "futures", "earn",
                        "margin", "income", "transfers"} and s["status"] == "ok")
    assert aged["pnl"] is not None      # 成交历史吃缓存，盈亏照算


def test_page_as_of_falls_back_when_no_live_source_succeeds(cache):
    """会变的那些一个都没成功时，退回全部成功来源——至少说出这页上的东西有多旧。"""
    snap = build(cache, fail={"/sapi": 451, "/fapi": 451, "/api/v3/ticker": 451})
    live = [s for s in snap["sources"]
            if s["key"] in {"prices", "wallets", "spot", "futures", "earn",
                            "margin", "income", "transfers"} and s["status"] == "ok"]
    assert live == []
    # 一个来源都没成功时如实报 None，而不是拿一个假时刻充数；页面本身仍然要能渲染
    assert snap["as_of"] is None
    assert snap["totals"] is None and snap["spot"] == []


def test_malformed_response_degrades_one_block_not_the_whole_page(cache):
    """一个来源的形状变了，只该带走那一块。

    缓存层兜得住网络与 HTTP 错误，但**字段解析在它外面**。Binance 改过字段类型
    （数组元素从对象变字符串这类），改之前这种情况会让整页 500——nginx 只给一句
    Bad Gateway，而设计原则从头到尾都是"按来源降级"。
    """
    base = make_transport()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/fapi/v2/account":
            # positions 从对象数组变成字符串数组
            return httpx.Response(200, json={"totalWalletBalance": "1",
                                             "positions": ["oops"]})
        return base.handler(request)

    client = BinanceClient("k", "s", client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    try:
        snap = build_portfolio(client, cache, force=True, now=NOW)   # 不抛就是通过
    finally:
        client.close()

    states = {s["key"]: s for s in snap["sources"]}
    assert states["futures"]["status"] == "unsupported"
    assert "形状意外" in states["futures"]["detail"]
    assert snap["futures"] is None
    # 其余照常
    assert states["spot"]["status"] == "ok" and snap["spot"]
    assert states["wallets"]["status"] == "ok" and snap["wallets"]
    assert snap["totals"] is not None


# --- 盈亏构成（成交法） ----------------------------------------------------

def test_pnl_has_no_residual_every_line_has_a_source(cache):
    """原先未实现变动是残差反解的，任何口径错误都会被它吸走而看不出来。
    现在每一项都有出处：现货来自逐日盯市，合约来自 positionRisk 与 income。"""
    snap = build(cache)
    pnl = snap["pnl"]
    assert pnl["unrealized"]["futures_usd"] == pytest.approx(
        snap["futures"]["total_unrealized_pnl"])
    assert pnl["realized"]["futures_usd"] == pytest.approx(
        snap["income"]["realized_pnl"])
    assert "90 天" in pnl["realized"]["futures_scope"]


def test_spot_has_no_cost_based_number_at_all(cache):
    """守住方向：现货这一侧不出"相对成本"的任何数——未实现没有，已实现也没有。

    两者要的是同一段补不齐的买入历史（划转 / 派息 / 小额兑换进来的币在 myTrades
    里没有痕迹）。卖得比看到的多时能被识破，可买得比看到的多、卖得不多时无声出错。
    """
    pnl = build(cache)["pnl"]
    assert set(pnl["unrealized"]) == {"futures_usd", "scope"}
    assert set(pnl["realized"]) == {"futures_usd", "futures_scope"}
    assert "spot_assets" not in pnl


def test_pnl_is_immune_to_wallet_transfers(cache):
    """这是换掉快照差额法的全部理由。把币从一个钱包挪到另一个，
    成交没变、持有量没变，盈亏就一分都不该动。"""
    before = build(cache)["pnl"]

    # 把 2 个 BNB 从现货挪进合约钱包：总持有量不变，只是换了地方
    from binance_mock import FUT_ACCOUNT, USER_ASSET
    bnb = next(a for a in USER_ASSET if a["asset"] == "BNB")
    moved = dict(bnb, free="2.212")
    USER_ASSET[USER_ASSET.index(bnb)] = moved
    FUT_ACCOUNT.setdefault("assets", []).append(
        {"asset": "BNB", "walletBalance": "2.0", "marginBalance": "2.0",
         "availableBalance": "2.0"})
    try:
        with cache.pool.connection() as conn:
            conn.execute("TRUNCATE binance_cache")
        after = build(cache)["pnl"]
        # 逐日盈亏按**跨全部钱包**的持有量算，币挪去哪个钱包都不影响
        assert after["today"]["spot_usd"] == pytest.approx(before["today"]["spot_usd"])
        assert [d["spot_usd"] for d in after["daily"]] == pytest.approx(
            [d["spot_usd"] for d in before["daily"]])
    finally:
        USER_ASSET[USER_ASSET.index(moved)] = bnb
        FUT_ACCOUNT["assets"] = [a for a in FUT_ACCOUNT["assets"]
                                 if a["asset"] != "BNB"]


def test_income_converts_by_asset_not_by_raw_amount(cache):
    """手续费常常用 BNB 抵扣（asset: BNB, income: -0.012）。不看 asset 直接相加
    等于把 0.012 个 BNB 当成 0.012 美元——手续费会凭空少掉几十倍。"""
    from binance_mock import INCOME
    extra = {"symbol": "BNBUSDT", "incomeType": "COMMISSION", "income": "-0.01",
             "asset": "BNB", "time": int(NOW.timestamp() * 1000)}
    base = build(cache)["income"]["commission"]
    INCOME.append(extra)
    try:
        with cache.pool.connection() as conn:
            conn.execute("TRUNCATE binance_cache")
        after = build(cache)["income"]["commission"]
        # 0.01 BNB 按 BNB 的美元价折算，不是 0.01 美元
        from binance_mock import PRICES
        bnb_usd = float(next(p["price"] for p in PRICES if p["symbol"] == "BNBUSDT"))
        assert after == pytest.approx(base - 0.01 * bnb_usd)
        assert abs(after - (base - 0.01)) > 1.0     # 确实不是当成 0.01 美元
    finally:
        INCOME.remove(extra)


def test_futures_wallet_exposes_per_asset_balances(cache):
    """把币划进合约当保证金是常见做法。只读 totalWalletBalance 的话，
    这些币在成本基础里就凭空消失了。"""
    snap = build(cache)
    by = {a["asset"]: a for a in snap["futures"]["assets"]}
    assert by["USDT"]["wallet_balance"] == pytest.approx(8426.13)
    # marginBalance 含浮盈，成本基础不能用它
    assert by["USDT"]["margin_balance"] == pytest.approx(8806.58)
    assert "PAXG" not in by      # 余额为 0 的不占位


def test_held_counts_coins_sitting_in_the_futures_wallet(cache):
    """合约钱包里的币要算进持有量——只看现货的话它凭空少一块。

    逐日盈亏用的就是这个持有量，所以 `spot_marks` 里的数量能反过来验它。
    """
    snap = build(cache)
    bnb = next(r for r in snap["pnl"]["spot_marks"] if r["asset"] == "BNB")
    spot_bnb = next(a["total"] for a in snap["spot"] if a["asset"] == "BNB")
    earn_bnb = sum(e["amount"] for e in snap["earn"] if e["asset"] == "BNB")
    marg_bnb = sum(a["net"] for a in snap["margin"]["assets"] if a["asset"] == "BNB")

    assert bnb["qty"] > spot_bnb            # 光看现货会少一块
    assert bnb["qty"] == pytest.approx(spot_bnb + earn_bnb + marg_bnb, rel=1e-9)


# --- 每日已实现（日历图） --------------------------------------------------



def test_daily_realized_ignores_transfers(cache):
    """划转不是损益。混进来的话，从现货转钱进合约那天会显示成大赚。"""
    from binance_mock import INCOME
    fake = {"symbol": "", "incomeType": "TRANSFER", "income": "99999",
            "asset": "USDT", "time": int(NOW.timestamp() * 1000)}
    before = build(cache)["pnl"]["today_usd"]
    INCOME.append(fake)
    try:
        with cache.pool.connection() as conn:
            conn.execute("TRUNCATE binance_cache")
        assert build(cache)["pnl"]["today_usd"] == pytest.approx(before)
    finally:
        INCOME.remove(fake)


def test_daily_realized_follows_the_passed_now_not_the_wall_clock(cache):
    """日历的最后一格必须是 `now` 那天，不是进程读到的今天。

    `_daily_realized` 原先自己调 `datetime.now()`，而 `build_portfolio` 全程用传进来的
    `now`。两者跨过一次日切就对不上：2026-09-03 凌晨整套测试红了一次，因为 mock 的
    NOW 停在 09-02。真实运行时的表现更隐蔽——页面时刻是昨天、日历最后一格却是今天。
    """
    from analyzer.binance.portfolio import build_portfolio
    from binance_mock import make_transport

    other = NOW - timedelta(days=11)
    client = BinanceClient("k", "s", client=httpx.Client(transport=make_transport()))
    try:
        snap = build_portfolio(client, cache, force=True, now=other)
    finally:
        client.close()
    daily = snap["pnl"]["daily"]
    assert daily[-1]["date"] == other.astimezone(timezone.utc).date().isoformat()
    assert daily[0]["date"] == (other - timedelta(days=89)).astimezone(
        timezone.utc).date().isoformat()


def _declared(name: str) -> set[str]:
    """从 console/src/api/types.ts 里读出某个类型的**顶层**字段名。

    只认两个空格缩进的那一层——`Pnl` 里有嵌套的对象字面量（today / unrealized /
    realized / carry），不限缩进的话会把里层字段也算成顶层的。
    """
    types = (pathlib.Path(__file__).resolve().parents[2] / "console" / "src" / "api"
             / "types.ts").read_text()
    block = re.search(rf"export type {name} = \{{(.*?)\n\}}", types, re.S)
    assert block, f"types.ts 里找不到 {name}"
    return set(re.findall(r"^  (\w+):", block.group(1), re.M))


def test_shapes_match_what_the_console_declares(cache):
    """后端返回的字段要和 console/src/api/types.ts 声明的一字不差。

    **类型检查查不出这种漂移**：后端多给一个字段前端不报错，少给一个也只在真跑到
    那一行才炸。删净值曲线时后端去掉了 change_24h_usd/pct，而前端类型与样例里还
    留着——真实数据里一直是 undefined，只有 mock 在编，谁都没发现。

    `pnl` 这一块 2026-09 连着重做了四轮（删归因、删现货未实现、改逐日盈亏、
    删整套成本基础引擎），是最容易漂的地方，所以逐个字段钉住。
    """
    snap = build(cache)
    assert set(snap["totals"]) == _declared("PortfolioTotals")
    assert set(snap["pnl"]) == _declared("Pnl")
    assert set(snap["pnl"]["daily"][0]) == _declared("DailyPnl")
    assert set(snap["pnl"]["spot_marks"][0]) == _declared("SpotMarkRow")
    assert set(snap["futures"]["assets"][0]) == _declared("WalletAsset")
    # 现货这一侧不该再有任何"相对成本"的字段冒出来
    assert "spot_assets" not in snap["pnl"]
    assert set(snap["pnl"]["realized"]) == {"futures_usd", "futures_scope"}



# --- 逐日盈亏：按当天的持仓量与当天的收盘价算 -------------------------------

def test_daily_counts_price_moves_not_just_settlements(cache):
    """不成交的日子也有盈亏。拿着 6 个 BNB 什么都不做，涨 10 块就是赚 60 块。

    原来一格只算"那天结算掉的"，于是不交易的日子全是 0——那不是"这天没赚没亏"，
    是"这天没成交"。
    """
    snap = build(cache)
    daily = snap["pnl"]["daily"]
    today = daily[-1]
    assert today["date"] == NOW.astimezone(timezone.utc).date().isoformat()

    # 样本里合约结算只发生在今天，往前的日子结算都是 0——可它们照样有盈亏，
    # 因为价格在动。这正是原来那版拿不到的东西。
    quiet = [d for d in daily[:-1] if d["settled_usd"] == 0]
    assert quiet, "样本里应当有不成交的日子"
    assert any(abs(d["spot_usd"]) > 1 for d in quiet), "不成交的日子也该有盈亏"

    assert today["pnl_usd"] == pytest.approx(today["spot_usd"] + today["settled_usd"])
    assert snap["pnl"]["today_usd"] == pytest.approx(today["pnl_usd"])


def test_daily_still_counts_settlements(cache):
    """资金费与手续费也是真金白银的进出，只报 REALIZED_PNL 会让"这天赚了多少"偏乐观。"""
    snap = build(cache)
    today = snap["pnl"]["daily"][-1]
    inc = snap["income"]
    assert today["settled_usd"] == pytest.approx(
        inc["realized_pnl"] + inc["funding_fee"] + inc["commission"]
        + inc["referral_kickback"])


def test_daily_covers_the_whole_window_including_quiet_days(cache):
    snap = build(cache)
    daily = snap["pnl"]["daily"]
    assert len(daily) == 90
    assert daily[0]["date"] == _day(89)
    assert all(d["known"] for d in daily), "样本里每天都算得出来"


def test_spot_half_uses_the_cross_wallet_quantity(cache):
    """"现货数据取不到"其实只是币不在现货钱包里。

    把 BNB 划进合约当保证金是常见做法，持有量一点没变。逐日盈亏按跨全部钱包的
    持有量算，所以划过去之后每天的数不变——只看现货余额的话，划走的那部分会凭空消失。
    """
    from binance_mock import FUT_ACCOUNT, USER_ASSET
    before = [d["spot_usd"] for d in build(cache)["pnl"]["daily"]]
    bnb = next(a for a in USER_ASSET if a["asset"] == "BNB")
    moved = dict(bnb, free="2.212")          # 现货 4.212 → 2.212，划出去 2 个
    USER_ASSET[USER_ASSET.index(bnb)] = moved
    FUT_ACCOUNT.setdefault("assets", []).append(
        {"asset": "BNB", "walletBalance": "2.0", "marginBalance": "2.0",
         "availableBalance": "2.0"})
    try:
        with cache.pool.connection() as conn:
            conn.execute("TRUNCATE binance_cache")
        after = [d["spot_usd"] for d in build(cache)["pnl"]["daily"]]
        assert after == pytest.approx(before)
    finally:
        USER_ASSET[USER_ASSET.index(moved)] = bnb
        FUT_ACCOUNT["assets"] = [a for a in FUT_ACCOUNT["assets"]
                                 if a["asset"] != "BNB"]


def test_todays_candle_is_the_live_price_not_yesterdays_close(cache):
    """日线最后一根是今天这根、还在走，它的 close 就是现价。

    拿倒数第一根当昨收的话今天永远是 0；拿倒数第二根当今价的话今天永远差一天。
    """
    snap = build(cache)
    bnb = next(r for r in snap["pnl"]["spot_marks"] if r["asset"] == "BNB")
    assert bnb["price_usd"] == pytest.approx(682.15)
    assert bnb["prev_close_usd"] == pytest.approx(682.15 * PREV_CLOSE_RATIO)


def test_stablecoins_stay_out_of_the_spot_half(cache):
    """USDT 面值不动，算进去只有噪声——而它的进出量最大，最容易把误差放大。"""
    snap = build(cache)
    assert all(row["asset"] != "USDT" for row in snap["pnl"]["spot_marks"])


def test_pnl_has_no_spot_unrealized_field(cache):
    """守住方向：现货没有"未实现"这一项，别再加回来。"""
    snap = build(cache)
    assert set(snap["pnl"]["unrealized"]) == {"futures_usd", "scope"}
