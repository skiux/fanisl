"""账户历史的定时任务：挂在采集进程上，每 10 分钟醒一次，大多数时候什么都不做。

    每次醒来
    ├─ 昨天的收盘快照还没有？  → 强制取一遍全部来源，写快照，再试着存定
    │                           （零点后 3 小时内才写；过了就当那天没有收盘）
    ├─ 昨天还没存定？         → 每小时重取一次（不强制），数据齐了就存定
    ├─ 距上次扫缓存满 1 小时？ → 把缓存里的原始记录沉淀进 binance_records
    └─ 今天还没取过派息？     → 取理财派息与 BFUSD 收益、刷一遍流水页的来源
                                （刚做完收盘的那一轮不取，推到下一轮：见 `run`）

为什么不靠页面：没人打开资产页的那天就会缺一份。为什么挂在采集进程而不是 API：
采集进程单实例（advisory lock），API 每次部署都重启、开发机上还可能同时开着一份。
收盘这件事要在 UTC 零点之后尽快做，所以它在采集进程里单独一个调度线程，
不排在知识库日报这类要跑几十分钟的任务后面（见 `worker_collector.py`）。

**从第一份收盘快照那天起才存定，不补存上线之前的日子**（用户 2026-10-03 定）。
上线那一刻窗口里的日子照旧现算显示，滑出 90 天就没了。之后哪天任务停过、没赶上
收盘快照，那天照样存定（`method='no_close'`），记录从开始那天起不留缺口。

口径与表结构见 `history.py`。
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from .cache import SourceCache, SourceResult
from .client import BinanceClient
from .dailypnl import estimated_yield_credits
from .history import REWARD_SOURCES, HistoryStore, day_end, extract_records
from .ledger import build_ledger
from .portfolio import _yield_positions, build_portfolio

# 存定一天要求这些来源都在那天结束之后成功取到过。它们决定逐日盈亏里的每一项：
# 当前余额（往回滚的起点）、成交与各类进出（往回滚的步子）、日线（盯市）、合约收支
# （当日结算）。合约档位、交易时段、账户能力这类元数据不影响那天赚了多少，不在里面。
FRESH_EXACT = frozenset({"prices", "wallets", "spot", "income", "futures.account", "margin"})
FRESH_PREFIX = ("transfers.", "flows.", "trades.", "close.", "earn.")

CLOSE_RETRY = timedelta(minutes=20)     # 收盘快照写不进去（钱包取不到）时多久再试
# 零点后多久之内的快照才算那天的收盘。再晚，净值里就混进了第二天的涨跌、理财按第二天
# 的持仓估算——2026-10-03 上线时记成 10-02 收盘的那份是 13:11 取的，就是这种
CLOSE_GRACE = timedelta(hours=3)
FREEZE_RETRY = timedelta(hours=1)       # 数据还不齐时多久重取一次
SWEEP_EVERY = timedelta(hours=1)
REWARDS_RETRY = timedelta(hours=1)
# 首次取派息时往回取多远。2026-10-03 在生产账户上实测：活期最早一条是 2026-04-23
# （约 163 天前），再往前一年都是空的；BFUSD 从 2026-09-03 起每天一条。180 天把两者都
# 盖住。活期单次跨度上限 30 天（超了报 -6021），180 天约 6 段、十几次请求，每次 150 权重
REWARDS_BACKFILL_DAYS = 180
REWARDS_RECENT_DAYS = 30


def blocking_sources(results: dict[str, SourceResult], day: str) -> list[str]:
    """存定这一天还差哪些来源：失败的，或者最后一次成功在那天结束之前的。

    `unsupported` 是账户没开这项功能（比如没开杠杆），不挡。
    """
    end = day_end(day)
    bad = []
    for key, result in sorted(results.items()):
        if key not in FRESH_EXACT and not key.startswith(FRESH_PREFIX):
            continue
        if result.status == "unsupported":
            continue
        if result.status != "ok" or result.as_of is None or result.as_of < end:
            bad.append(key)
    return bad


def full_day_earn(payload: dict | None, day: str) -> float | None:
    """按那天收盘快照里的理财持仓，估算一整天的理财收益。没有收盘快照就是 None"""
    if not payload:
        return None
    positions = _yield_positions(
        payload.get("earn") or [], payload.get("spot") or [], payload.get("futures"),
        payload.get("margin"), (payload.get("yield_rates") or {}).get("BFUSD"))
    # 用"那天的最后一刻"当作现在：estimated_yield_credits 按零点起已过的比例计提，
    # 这样正好是一整天
    got = estimated_yield_credits(positions, days=1,
                                  now=day_end(day) - timedelta(microseconds=1))
    return float(got["days"].get(day, 0.0))


def trim_snapshot(snapshot: dict) -> dict:
    """收盘快照里不存逐日盈亏那一串：它另有 daily_pnl 一张表，存进来每天都是 90 行重复"""
    pnl = snapshot.get("pnl")
    if not isinstance(pnl, dict):
        return snapshot
    return {**snapshot, "pnl": {k: v for k, v in pnl.items() if k != "daily"}}


def freeze_days(store: HistoryStore, live_daily: list[dict],
                results: dict[str, SourceResult], now: datetime) -> list[str]:
    """把能存定的日子存定，返回这次存定了哪几天。

    今天不存（还没结束）；第一份收盘快照之前的不存（不补存上线以前）；已经存定的不碰；
    算不出来的那天（`known` 为假）不存——它不是 0，存成 0 就把"不知道"变成了"没赚没亏"。
    """
    start = store.first_snapshot_day()
    if start is None:
        return []
    today = now.astimezone(timezone.utc).date().isoformat()
    frozen = store.frozen_days()
    done = []
    for row in live_daily:
        day = row["date"]
        if day < start or day >= today or day in frozen or not row.get("known"):
            continue
        if blocking_sources(results, day):
            continue
        earn = full_day_earn(store.snapshot_payload(day), day)
        earn_method = "estimate_full_day" if earn is not None else "none"
        earn = row["earn_usd"] if earn is None else earn
        pnl = row["spot_usd"] + row["stock_usd"] + row["settled_usd"] + earn + row["interest_usd"]
        stored = {**row, "earn_usd": earn, "pnl_usd": pnl}
        # 有收盘快照的那天是"收盘后存定"；没有的（任务停过、零点后 3 小时内没写成）记 no_close
        method = "close" if earn_method == "estimate_full_day" else "no_close"
        if store.freeze(stored, earn_method=earn_method, method=method):
            done.append(day)
    return done


def sweep_records(cache: SourceCache, store: HistoryStore) -> dict[str, int]:
    """把缓存里的原始记录沉淀下来，返回各来源新增或有变的条数"""
    return {source: store.upsert_records(source, rows)
            for source, rows in extract_records(cache.payloads()).items()}


class HistoryJob:
    """进程内的状态只是"上次做了什么"的时间戳：重启之后全部重来一遍，任务本身幂等。"""

    def __init__(self, client: BinanceClient, cache: SourceCache, *,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self.client = client
        self.cache = cache
        self.clock = clock
        self.last_build: datetime | None = None
        self.last_sweep: datetime | None = None
        self.last_rewards: datetime | None = None
        self.rewards_day: date | None = None
        self.missed_close: date | None = None
        # 这个进程里已经补取过的派息来源。账户没有定期派息时库里永远是 0 条，
        # 只看条数的话每天都会重新往回取 180 天
        self.backfilled: set[str] = set()

    def __call__(self) -> None:
        # 没配凭据（开发机上常见）：每个来源都会是 unauthorized，跑了只会每小时打一串错
        if self.client.signer is None:
            return
        self.run(self.clock())

    def run(self, now: datetime) -> dict[str, Any]:
        store = self.cache.history
        report: dict[str, Any] = {}
        today = now.astimezone(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        in_grace = now < day_end(yesterday) + CLOSE_GRACE
        need_close = in_grace and not store.has_snapshot(yesterday)
        if not in_grace and self.missed_close != yesterday and not store.has_snapshot(yesterday):
            self.missed_close = yesterday
            print(f"[history] {yesterday} 没有收盘快照：零点后 3 小时内没写成，那天不算有收盘",
                  file=sys.stderr, flush=True)
        start = store.first_snapshot_day()
        need_freeze = (start is not None and yesterday.isoformat() >= start
                       and yesterday.isoformat() not in store.frozen_days())
        since = None if self.last_build is None else now - self.last_build
        closing = False
        if (need_close and (since is None or since >= CLOSE_RETRY)) or \
                (need_freeze and (since is None or since >= FREEZE_RETRY)):
            report.update(self.build(now, close_day=yesterday if need_close else None))
            closing = need_close
            # 昨天存不定要留下原因：一个来源一直失败，那天会在滑出 90 天窗口时永久丢掉。
            # 收盘那一轮不报——提现记录不随强制刷新重取（NEVER_FORCE），缓存还是零点前的，
            # 那一轮几乎总是差它；一小时后的重试还存不定才是该看的
            if not closing and "pending" in report:
                print(f"[history] {yesterday} 暂未存定，{report['pending']}",
                      file=sys.stderr, flush=True)

        if self.last_sweep is None or now - self.last_sweep >= SWEEP_EVERY:
            report["records"] = sweep_records(self.cache, store)
            self.last_sweep = now

        # 收盘那一轮刚强制取过全部来源（闪兑一次就是 3000 权重），派息补取与流水页的
        # 来源再叠上去，同一分钟里的权重会逼近上限（SAPI 6000/分钟，见 README）。
        # 推到下一轮，也就是 10 分钟后
        if not closing and self.rewards_day != today and (
                self.last_rewards is None or now - self.last_rewards >= REWARDS_RETRY):
            self.last_rewards = now
            report["rewards"] = self.capture_daily(now, store)
            if all(v is not None for v in report["rewards"].values()):
                self.rewards_day = today
        return report

    def build(self, now: datetime, *, close_day: date | None) -> dict[str, Any]:
        """取一遍资产快照：要写收盘时强制刷新全部来源，否则按缓存走。然后试着存定"""
        store = self.cache.history
        results: dict[str, SourceResult] = {}
        closing = close_day is not None
        snapshot = build_portfolio(self.client, self.cache, force=closing, force_flows=closing,
                                   now=now, results_out=results, merge_history=False)
        self.last_build = now
        report: dict[str, Any] = {}
        totals = snapshot.get("totals")
        if closing and totals is not None:
            # 钱包取不到就没有净值：不写一份没有净值的"收盘"，20 分钟后再试
            report["snapshot"] = store.write_snapshot(
                day=close_day, taken_at=now, as_of=snapshot.get("as_of"),
                equity_usd=totals["equity_usd"], cash_usd=store.cash_now(),
                complete=not blocking_sources(results, close_day.isoformat()),
                sources=snapshot.get("sources") or [], payload=trim_snapshot(snapshot))
        live = (snapshot.get("pnl") or {}).get("daily") or []
        report["frozen"] = freeze_days(store, live, results, now)
        day = (now.astimezone(timezone.utc).date() - timedelta(days=1)).isoformat()
        start = store.first_snapshot_day()
        if start is not None and day >= start and day not in store.frozen_days():
            row = next((r for r in live if r["date"] == day), None)
            report["pending"] = (
                "那天算不出来（known=false）" if row is not None and not row.get("known")
                else f"来源未齐：{', '.join(blocking_sources(results, day)) or '无日历'}")
        return report

    def capture_daily(self, now: datetime, store: HistoryStore) -> dict[str, int | None]:
        """一天一次：派息记录（不经过缓存）与流水页的来源（钱包划转只在那里取）。

        每一项单独兜住：一个接口失败不影响别的，失败的记 None，一小时后整组再来。
        """
        end_ms = int(now.timestamp() * 1000)
        out: dict[str, int | None] = {}
        for product, record_id in REWARD_SOURCES.items():
            source = f"{'bfusd' if product == 'bfusd' else 'earn_' + product}_rewards"
            backfill = source not in self.backfilled and store.record_count(source) == 0
            days = REWARDS_BACKFILL_DAYS if backfill else REWARDS_RECENT_DAYS
            try:
                got = self.client.rewards_history(
                    product, start_ms=end_ms - days * 86_400_000, end_ms=end_ms)
            except Exception as e:  # noqa: BLE001
                print(f"[history] 取 {source} 失败：{e!r}", file=sys.stderr, flush=True)
                out[source] = None
                continue
            rows = [row for row in got.get("rows", []) if isinstance(row, dict)]
            out[source] = store.upsert_records(source, [
                (record_id(row), _row_time(row), row) for row in rows])
            self.backfilled.add(source)
        try:
            build_ledger(self.client, self.cache, days=30, force=False)
            out["ledger"] = 0
        except Exception as e:  # noqa: BLE001
            print(f"[history] 刷新流水来源失败：{e!r}", file=sys.stderr, flush=True)
            out["ledger"] = None
        return out


def _row_time(row: dict) -> datetime | None:
    raw = row.get("time")
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
    return None
