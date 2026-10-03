"""账户历史：收盘快照、存定的逐日盈亏、原始记录，以及把它们写进去的定时任务。

要守住的是"存下的东西不再变"和"数据不齐不存"：前者错了，历史会随重算悄悄改动；
后者错了，一个取数失败的结果会被永久存成那天的盈亏。
"""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from fanisl.binance.cache import SourceCache, SourceResult
from fanisl.binance.client import BinanceClient, BinanceError
from fanisl.binance.fund import FundStore
from fanisl.binance.history import day_end, extract_records, merge_daily
from fanisl.binance.history_job import (
    BACKFILL_RETRY, BACKFILLS, HistoryJob, blocking_sources, full_day_earn, trim_snapshot,
)
from fanisl.binance.portfolio import build_portfolio

from binance_mock import NOW, _day, equity_daily, make_transport

YESTERDAY = _day(1)
# 收盘那一轮：零点刚过。假 Binance 的样本以 NOW（12:00）为准，同一天，日历一样
CLOSE_AT = day_end(YESTERDAY) + timedelta(minutes=10)


@pytest.fixture(autouse=True)
def equity_closes(monkeypatch):
    monkeypatch.setattr("fanisl.binance.portfolio.fetch_daily_adjclose", equity_daily)


@pytest.fixture
def cache(pool):
    cache = SourceCache(pool)
    cache.history
    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_spot_costs, binance_stock_costs, binance_cache, "
                     "account_snapshots, daily_pnl, binance_records, history_backfills")
    return cache


def client(**kw) -> BinanceClient:
    return BinanceClient("k", "s", client=httpx.Client(transport=make_transport(**kw)))


def row(day: str, pnl: float, **kw) -> dict:
    base = {"date": day, "spot_usd": pnl, "stock_usd": 0.0, "settled_usd": 0.0,
            "settled_parts": None, "earn_usd": 0.0, "interest_usd": 0.0, "pnl_usd": pnl,
            "known": True}
    return {**base, **kw}


# --- 存储 -----------------------------------------------------------------

def test_snapshot_is_written_once_and_nav_includes_cash(cache):
    store = cache.history
    kw = dict(taken_at=NOW, as_of=NOW.isoformat(), complete=True, sources=[], payload={"a": 1})
    assert store.write_snapshot(day=NOW.date(), equity_usd=1000.0, cash_usd=250.0, **kw)
    # 收盘只有一份：后来的不覆盖
    assert not store.write_snapshot(day=NOW.date(), equity_usd=9999.0, cash_usd=0.0, **kw)
    assert store.closes() == {NOW.date().isoformat(): 1250.0}
    assert store.snapshot_payload(NOW.date()) == {"a": 1}
    # 钱包取不到的那天没有净值，不出现在收盘净值里
    store.write_snapshot(day=NOW.date() - timedelta(days=1), equity_usd=None, cash_usd=0.0, **kw)
    assert list(store.closes()) == [NOW.date().isoformat()]


def test_frozen_day_is_not_overwritten(cache):
    store = cache.history
    assert store.freeze(row("2026-08-01", 12.5, settled_parts={"funding": 1.0}),
                        earn_method="none", method="backfill")
    assert not store.freeze(row("2026-08-01", -99.0), earn_method="none", method="close")
    got = store.frozen_days()["2026-08-01"]
    assert got["pnl_usd"] == 12.5
    assert got["settled_parts"] == {"funding": 1.0}
    assert got["known"] is True


def test_records_dedupe_and_track_changes(cache):
    store = cache.history
    at = datetime(2026, 9, 1, tzinfo=timezone.utc)
    items = [("1", at, {"id": 1, "status": 0}), ("2", at, {"id": 2, "status": 1})]
    assert store.upsert_records("withdrawals", items) == 2
    assert store.upsert_records("withdrawals", items) == 0
    # 交易所改了一条（提现从处理中到完成）：只更新那一条
    assert store.upsert_records("withdrawals", [("1", at, {"id": 1, "status": 6})]) == 1
    assert store.record_count("withdrawals") == 2


def test_merge_daily_prefers_frozen_rows_and_extends_the_window():
    live = [row("2026-09-01", 5.0), row("2026-09-02", 7.0)]
    frozen = {"2026-08-20": row("2026-08-20", 3.0), "2026-09-01": row("2026-09-01", 4.0)}
    merged = merge_daily(live, frozen, {"2026-09-01": 1234.0})
    assert [(r["date"], r["pnl_usd"], r["frozen"]) for r in merged] == [
        ("2026-08-20", 3.0, True), ("2026-09-01", 4.0, True), ("2026-09-02", 7.0, False)]
    assert [r["nav_close_usd"] for r in merged] == [None, 1234.0, None]


# --- 判断能不能存定 -------------------------------------------------------------

def test_blocking_sources_requires_fetches_after_the_day_ended():
    end = day_end(YESTERDAY)

    def res(status, at):
        return SourceResult("x", [], status, at, None)

    results = {
        "prices": res("ok", end + timedelta(minutes=5)),
        "trades.BNBUSDT": res("ok", end - timedelta(minutes=1)),   # 零点前的缓存
        "close.BNBUSDT": res("unreachable", end + timedelta(minutes=5)),
        "margin": res("unsupported", None),                         # 没开杠杆，不挡
        "futures.brackets": res("unreachable", None),               # 不影响盈亏，不看
    }
    assert blocking_sources(results, YESTERDAY) == ["close.BNBUSDT", "trades.BNBUSDT"]


def test_full_day_earn_uses_the_close_positions():
    payload = {"earn": [{"asset": "USDT", "amount": 1000, "value_usd": 1000.0, "apr": 0.0365}],
               "spot": [], "futures": None, "margin": None, "yield_rates": {"BFUSD": None}}
    assert full_day_earn(payload, "2026-09-01") == pytest.approx(0.1)
    assert full_day_earn(None, "2026-09-01") is None


def test_trim_snapshot_drops_only_the_daily_series():
    snap = {"totals": {"equity_usd": 1}, "pnl": {"daily": [1, 2], "today": {"total_usd": 3}}}
    assert trim_snapshot(snap) == {"totals": {"equity_usd": 1}, "pnl": {"today": {"total_usd": 3}}}


# --- 任务 -----------------------------------------------------------------

def test_job_writes_the_close_and_freezes_closed_days(cache, pool, auth_store):
    FundStore(pool).save_settings(initial_nav_usd=None, inception_date=None, cash_usd=500,
                                  updated_by=1)
    job = HistoryJob(client(), cache)
    report = job.run(CLOSE_AT)
    store = cache.history

    assert report["snapshot"] is True
    live = build_portfolio(client(), cache, now=NOW, merge_history=False)
    assert store.closes()[YESTERDAY] == pytest.approx(live["totals"]["equity_usd"] + 500)

    frozen = store.frozen_days()
    assert YESTERDAY in report["frozen"] and YESTERDAY in frozen
    assert _day(0) not in frozen                     # 今天还没结束
    with pool.connection() as conn:
        methods = {r["day"].isoformat(): (r["method"], r["earn_method"]) for r in conn.execute(
            "SELECT day, method, earn_method FROM daily_pnl").fetchall()}
    assert methods[YESTERDAY] == ("close", "estimate_full_day")
    # 不补存：第一份收盘快照之前的日子照旧现算，不存
    assert list(methods) == [YESTERDAY]

    # 收盘那天的理财按收盘持仓记一整天：今天 12:00 已计提半天，同样的持仓
    today = next(r for r in live["pnl"]["daily"] if r["date"] == _day(0))
    assert frozen[YESTERDAY]["earn_usd"] == pytest.approx(2 * today["earn_usd"])
    parts = ("spot_usd", "stock_usd", "settled_usd", "earn_usd", "interest_usd")
    assert frozen[YESTERDAY]["pnl_usd"] == pytest.approx(sum(frozen[YESTERDAY][k] for k in parts))

    # 资产页的日历用存定的那份，并带上收盘净值
    page = {r["date"]: r for r in build_portfolio(client(), cache, now=NOW)["pnl"]["daily"]}
    assert page[YESTERDAY]["frozen"] is True
    assert page[YESTERDAY]["earn_usd"] == frozen[YESTERDAY]["earn_usd"]
    assert page[YESTERDAY]["nav_close_usd"] == pytest.approx(store.closes()[YESTERDAY])
    assert page[_day(0)]["frozen"] is False and page[_day(0)]["nav_close_usd"] is None


def test_a_late_close_is_not_written_and_nothing_is_backfilled(cache):
    """零点后 3 小时内没写成的收盘不补：12:00 取的不是收盘。还没有任何收盘快照时什么都不存"""
    calls: list[str] = []
    job = HistoryJob(BinanceClient("k", "s", client=httpx.Client(
        transport=make_transport(calls=calls))), cache)
    report = job.run(NOW)
    assert "snapshot" not in report and "frozen" not in report
    assert cache.history.closes() == {} and cache.history.frozen_days() == {}
    assert "/sapi/v1/asset/wallet/balance" not in calls     # 没有去取资产快照


def test_days_after_recording_started_are_kept_even_without_a_close(cache):
    """开始记录之后，任务停过、没赶上收盘的日子照样存定（no_close），记录不留缺口"""
    store = cache.history
    store.write_snapshot(day=_day(3), taken_at=NOW, as_of=None, equity_usd=1000.0,
                         cash_usd=0.0, complete=True, sources=[], payload={"earn": []})
    report = HistoryJob(client(), cache).run(NOW)
    assert sorted(report["frozen"]) == [_day(3), _day(2), _day(1)]
    with cache.pool.connection() as conn:
        methods = {r["day"].isoformat(): r["method"] for r in conn.execute(
            "SELECT day, method FROM daily_pnl").fetchall()}
    assert methods == {_day(3): "close", _day(2): "no_close", _day(1): "no_close"}


def test_job_does_nothing_more_once_the_day_is_stored(cache):
    calls: list[str] = []
    for source in BACKFILLS:                          # 补取另有用例，这里当作已补完
        cache.history.mark_backfilled(source, since=NOW, records=0)
    job = HistoryJob(BinanceClient("k", "s", client=httpx.Client(
        transport=make_transport(calls=calls))), cache)
    job.run(CLOSE_AT)
    assert "rewards" in job.run(CLOSE_AT + timedelta(minutes=10))   # 收盘那一轮之后再取
    calls.clear()
    report = job.run(CLOSE_AT + timedelta(minutes=20))
    assert report == {}
    assert calls == []


def test_failed_source_blocks_the_freeze_until_a_later_fetch(cache):
    store = cache.history
    job = HistoryJob(client(fail={"/fapi/v1/income": 500}), cache)
    report = job.run(CLOSE_AT)
    # 快照照写（钱包是好的），但标成不完整；那天不存定
    assert report["snapshot"] is True and report["frozen"] == []
    with cache.pool.connection() as conn:
        assert conn.execute("SELECT complete FROM account_snapshots").fetchone()["complete"] is False

    # 半小时后：收盘已有，存定的重试按小时，不动
    assert "frozen" not in job.run(CLOSE_AT + timedelta(minutes=30))
    # 一小时后接口恢复：不强制刷新，但失败的来源没有可用缓存，会重取
    job.client = client()
    report = job.run(CLOSE_AT + timedelta(minutes=61))
    assert YESTERDAY in report["frozen"]
    assert "snapshot" not in report                  # 收盘只写一次
    assert YESTERDAY in store.frozen_days()


def test_job_sweeps_cached_records_and_captures_rewards(cache):
    store = cache.history
    job = HistoryJob(client(), cache)
    report = job.run(CLOSE_AT)
    assert report["records"]["futures_income"] > 0
    assert report["records"]["withdrawals"] == 1
    # 收盘那一轮刚强制取过全部来源，另取与补取都推到下一轮，免得权重挤在同一分钟
    assert "rewards" not in report and "backfill" not in report
    at = CLOSE_AT + timedelta(minutes=10)
    report = job.run(at)
    # 每天另取最近 30 天：活期同一时刻的 REALTIME 与 BONUS 是两条，45 天前那条不在里面；
    # 交易所日快照三类轮着取
    snapshot = f"account_snapshot_{('spot', 'margin', 'futures')[at.date().toordinal() % 3]}"
    assert set(report["rewards"]) == {"earn_flexible_rewards", "earn_locked_rewards",
                                      "bfusd_rewards", "p2p_orders", "pay_transactions",
                                      snapshot, "ledger"}
    assert report["rewards"]["earn_flexible_rewards"] == 2
    assert report["rewards"]["p2p_orders"] == 1 and report["rewards"]["pay_transactions"] == 1
    assert None not in report["rewards"].values()
    # 同一轮开始补取，每轮一类：P2P 一年内的 3 单（含取消的）都在
    assert report["backfill"] == {"p2p_orders": 2}
    assert store.record_count("p2p_orders") == 3
    # 钱包划转只在流水页的来源里：任务每天刷一遍流水页，下一次扫缓存就沉淀下来
    later = job.run(CLOSE_AT + timedelta(hours=1, minutes=1))
    assert later["records"]["wallet_transfers"] > 0
    assert later["records"]["futures_income"] == 0  # 已经存过的不重复计
    assert "rewards" not in later                    # 一天一次
    assert later["backfill"] == {"pay_transactions": 1}


def test_backfill_takes_each_source_once_as_far_back_as_the_api_allows(cache):
    """补取：每类一次、每轮一类；划转只问 180 天以内，Pay 每段不超过 90 天（假接口照真接口拒绝）"""
    requests: list[tuple[str, dict]] = []
    base = make_transport()

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.url.path, dict(request.url.params)))
        return base.handler(request)

    def make_job():
        return HistoryJob(BinanceClient("k", "s", client=httpx.Client(
            transport=httpx.MockTransport(handler))), cache)

    store, job = cache.history, make_job()
    done = []
    while (got := job.backfill_next(CLOSE_AT, store)) is not None:
        done.append(got)
        assert len(done) <= len(BACKFILLS)
    assert [next(iter(d)) for d in done] == list(BACKFILLS)
    assert all(None not in d.values() for d in done)
    assert store.backfilled() == set(BACKFILLS)

    # 一年内能取到的都在：200 天前取消的 P2P、150 天前的 Pay、45 天前的活期派息
    assert store.record_count("p2p_orders") == 3
    assert store.record_count("pay_transactions") == 2
    assert store.record_count("earn_flexible_rewards") == 3
    assert store.record_count("account_snapshot_spot") == 2
    earliest = int((CLOSE_AT - timedelta(days=180)).timestamp() * 1000)
    assert all(int(p["startTime"]) >= earliest for path, p in requests
               if path == "/sapi/v1/asset/transfer")

    # 重启之后不重来：补没补过记在库里
    requests.clear()
    assert make_job().backfill_next(CLOSE_AT, store) is None
    assert requests == []


def test_a_failed_backfill_does_not_hold_up_the_rest(cache):
    store = cache.history
    job = HistoryJob(client(fail={"/sapi/v1/c2c": 500}), cache)
    assert job.backfill_next(CLOSE_AT, store) == {"p2p_orders": None}
    assert next(iter(job.backfill_next(CLOSE_AT, store))) == "pay_transactions"
    # 隔一阵再试那一类，接口恢复了就补上
    job.client = client()
    later = CLOSE_AT + BACKFILL_RETRY + timedelta(minutes=1)
    assert job.backfill_next(later, store) == {"p2p_orders": 3}
    assert "p2p_orders" in store.backfilled()


def test_extract_records_dedupes_across_cache_keys():
    income = [{"tranId": 7, "incomeType": "FUNDING_FEE", "asset": "USDT", "symbol": "NVDAUSDT",
               "income": "-0.3", "time": 1_700_000_000_000},
              {"tranId": 7, "incomeType": "COMMISSION", "asset": "USDT", "symbol": "NVDAUSDT",
               "income": "-0.1", "time": 1_700_000_000_000}]
    got = extract_records([
        ("income", income),
        ("ledger.income:30d", income[:1]),           # 同一条在流水页的缓存里又出现一次
        ("trades.BNBUSDT", [{"id": 1, "time": 1_700_000_000_000}]),
        ("flows.convert", {"list": [{"orderId": 55, "createTime": 1_700_000_000_000}]}),
        ("futures.account", {"assets": []}),          # 不是记录
    ])
    assert sorted(r[0] for r in got["futures_income"]) == [
        "7:COMMISSION:USDT:NVDAUSDT", "7:FUNDING_FEE:USDT:NVDAUSDT"]
    assert [r[0] for r in got["spot_trades"]] == ["BNBUSDT:1"]
    assert [r[0] for r in got["convert"]] == ["55"]
    assert set(got) == {"futures_income", "spot_trades", "convert"}


def test_job_skips_without_credentials(cache):
    job = HistoryJob(BinanceClient("", ""), cache, clock=lambda: NOW)
    job()
    assert not cache.history.has_snapshot(NOW.date() - timedelta(days=1))
    assert job.last_build is None


# --- 派息接口 ---------------------------------------------------------------

def test_rewards_history_splits_windows_and_pages():
    spans: list[int] = []
    day = 86_400_000
    end = int(NOW.timestamp() * 1000)
    rows = [{"asset": "USDT", "type": "REALTIME", "time": end - i * day} for i in range(70)]

    def handler(request: httpx.Request) -> httpx.Response:
        p = dict(request.url.params)
        start, stop = int(p["startTime"]), int(p["endTime"])
        size, current = int(p["size"]), int(p["current"])
        if current == 1:
            spans.append(stop - start)
        hits = [r for r in rows if start <= r["time"] <= stop]
        return httpx.Response(200, json={"total": len(hits),
                                         "rows": hits[(current - 1) * size: current * size]})

    c = BinanceClient("k", "s", client=httpx.Client(transport=httpx.MockTransport(handler)))
    got = c.rewards_history("flexible", start_ms=end - 69 * day, end_ms=end, size=10)
    assert len(got["rows"]) == 70 and got["total"] == 70
    assert len(spans) == 3 and max(spans) <= 30 * day


def test_rewards_history_refuses_a_malformed_page():
    c = BinanceClient("k", "s", client=httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={"total": 0}))))
    with pytest.raises(BinanceError):
        c.rewards_history("bfusd", start_ms=0, end_ms=1000)
