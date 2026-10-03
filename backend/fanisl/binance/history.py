"""账户历史：每天收盘的快照、存定的逐日盈亏、只追加的原始记录。

## 为什么要有它

在这之前，数据库里和 Binance 账户有关的只有每个来源"最近一份"的缓存（`binance_cache`，
覆盖写）。日历每次请求都从今天的余额往回倒推，于是：最多 90 天（部分来源 30 天）；
过去的日子会随重算变化；理财本金与年化这类交易所不留历史的东西一过当天就没了；
账户每天的净值从来没有存下来过。基金式的记账（份额、高水位、按年结算、风险准备金）
都要以"每天的净值"和"每一笔进出"为底，所以先把这三样存下来：

| 表 | 一行是 | 写入 | 之后会变吗 |
|---|---|---|---|
| `account_snapshots` | 某个 UTC 日收盘时的账户全貌 | 次日零点后 3 小时内（`history_job.py`） | 不变 |
| `daily_pnl` | 某一天的盈亏，各分项 | 那天结束、相关来源都在那之后取到过；从第一份收盘快照那天起 | 不变 |
| `binance_records` | 交易所给的一条原始记录 | 每小时从缓存里扫，派息另取 | 只在交易所改了它时更新（充提状态） |

## 几条规矩

- **从现在开始存，不补以前。** 存定从第一份收盘快照那天开始（用户 2026-10-03 定）；
  上线那一刻窗口里的日子照旧现算显示，滑出 90 天就没了。
- **存下的东西不重算。** 日历上一天一旦存定，之后的请求直接用存定的数，不再从当前余额
  倒推——倒推会随窗口滑动、来源失败、算法修改而变。要改只能删掉那一行，等任务重存
  （还在 90 天窗口内才能重存）。
- **存定要等数据齐。** 一天结束之后，它用到的每个来源都要在那一刻之后成功取到过
  （`blocking_sources`）：成交、日线、充提、合约收支……缓存时长各不相同，日线缓存
  15 分钟、成交 6 小时——零点刚过时缓存里的日线还是前一天 23:5x 的价，那不是收盘价。
- **理财收益按收盘时的本金与年化记一整天。** 逐日盈亏的理财一项只给"今天从零点起已过
  的比例"，过去的日子是 0（当前数据无法重建过去的本金）。收盘快照里存着当天的理财
  持仓，存定那一天时用它补上整天的估算，`earn_method` 记成 `estimate_full_day`；
  没有收盘快照的日子（任务停过、零点后 3 小时内没写成）记 `none`，仍是 0。派息记录从现在起
  也在存，但 2026-09-27 发现它与账户实际收益对不上、已从逐日盈亏里停用（见
  `dailypnl.py`）；要拿它替代估算，得先用存下的记录与收盘快照查清差在哪。
- **快照的净值含交易所以外的现金**（`fund_settings.cash_usd`），与资产页同一个口径。
- **原始记录按交易所的记录 id 去重**，id 规则见 `RECORD_SOURCES`。缓存里的旧数据
  （来源这次失败、回落到上一次成功的那份）照样能沉淀：那份数据本身是对的。

为什么放在 binance/ 而不是一个新包：这些表都是 console 的数据，席位边界见 AGENTS.md。
任务挂在采集进程上（`worker_collector.py`），见 `history_job.py`。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from psycopg_pool import ConnectionPool

from .common import ms_to_iso

# API 与采集进程都会建这几张表，常在同一刻启动（auto-update 一起重启）：
# CREATE ... IF NOT EXISTS 并发时也会撞上 pg_type 的唯一约束，先拿一把事务级的锁
_SCHEMA = """
SELECT pg_advisory_xact_lock(hashtext('fanisl.history_schema'));
CREATE TABLE IF NOT EXISTS account_snapshots (
    day         DATE PRIMARY KEY,
    taken_at    TIMESTAMPTZ NOT NULL,
    as_of       TIMESTAMPTZ,
    equity_usd  NUMERIC,
    cash_usd    NUMERIC NOT NULL DEFAULT 0,
    nav_usd     NUMERIC,
    complete    BOOLEAN NOT NULL,
    sources     JSONB NOT NULL,
    payload     JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_pnl (
    day           DATE PRIMARY KEY,
    spot_usd      NUMERIC NOT NULL,
    stock_usd     NUMERIC NOT NULL,
    settled_usd   NUMERIC NOT NULL,
    settled_parts JSONB,
    earn_usd      NUMERIC NOT NULL,
    interest_usd  NUMERIC NOT NULL,
    pnl_usd       NUMERIC NOT NULL,
    earn_method   TEXT NOT NULL,
    method        TEXT NOT NULL,
    frozen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS binance_records (
    source      TEXT NOT NULL,
    record_id   TEXT NOT NULL,
    occurred_at TIMESTAMPTZ,
    payload     JSONB NOT NULL,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, record_id)
);
CREATE INDEX IF NOT EXISTS idx_binance_records_time ON binance_records (source, occurred_at);
"""

_DAILY_COLS = ("day, spot_usd, stock_usd, settled_usd, settled_parts, earn_usd, "
               "interest_usd, pnl_usd, earn_method, method, frozen_at")


def day_end(day: str | date) -> datetime:
    """一个 UTC 日的结束时刻，也就是下一天的零点"""
    d = date.fromisoformat(day) if isinstance(day, str) else day
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(days=1)


class HistoryStore:
    def __init__(self, pool: ConnectionPool) -> None:
        self.pool = pool
        with pool.connection() as conn:
            conn.execute(_SCHEMA)

    # --- 收盘快照 -------------------------------------------------------------

    def has_snapshot(self, day: date) -> bool:
        with self.pool.connection() as conn:
            return conn.execute("SELECT 1 FROM account_snapshots WHERE day = %s",
                                (day,)).fetchone() is not None

    def write_snapshot(self, *, day: date, taken_at: datetime, as_of: str | None,
                       equity_usd: float | None, cash_usd: float, complete: bool,
                       sources: list[dict], payload: dict) -> bool:
        """写一天的收盘快照。已经有了就不写（返回 False）：收盘只有一份，不被后来的覆盖。"""
        nav = None if equity_usd is None else equity_usd + cash_usd
        with self.pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO account_snapshots (day, taken_at, as_of, equity_usd, cash_usd, "
                "nav_usd, complete, sources, payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (day) DO NOTHING RETURNING day",
                (day, taken_at, as_of, equity_usd, cash_usd, nav, complete,
                 json.dumps(sources, ensure_ascii=False),
                 json.dumps(payload, ensure_ascii=False))).fetchone()
        return row is not None

    def first_snapshot_day(self) -> str | None:
        """开始记录的那天：第一份收盘快照的日子。存定从这天起，不往前补"""
        with self.pool.connection() as conn:
            row = conn.execute("SELECT min(day) AS day FROM account_snapshots").fetchone()
        return row["day"].isoformat() if row and row["day"] else None

    def snapshot_payload(self, day: str | date) -> dict | None:
        with self.pool.connection() as conn:
            row = conn.execute("SELECT payload FROM account_snapshots WHERE day = %s",
                               (day,)).fetchone()
        return row["payload"] if row else None

    def closes(self) -> dict[str, float]:
        """每天收盘的净值（含现金）：`{YYYY-MM-DD: nav_usd}`。取不到净值的那天不在里面"""
        with self.pool.connection() as conn:
            rows = conn.execute("SELECT day, nav_usd FROM account_snapshots "
                                "WHERE nav_usd IS NOT NULL ORDER BY day").fetchall()
        return {row["day"].isoformat(): float(row["nav_usd"]) for row in rows}

    def cash_now(self) -> float:
        """此刻录入的交易所以外现金。表还没建（API 从没起过）或没录就是 0"""
        with self.pool.connection() as conn:
            exists = conn.execute("SELECT to_regclass('fund_settings') AS t").fetchone()["t"]
            if exists is None:
                return 0.0
            row = conn.execute("SELECT cash_usd FROM fund_settings").fetchone()
        return float(row["cash_usd"]) if row and row["cash_usd"] is not None else 0.0

    # --- 存定的逐日盈亏 -------------------------------------------------------

    def frozen_days(self) -> dict[str, dict]:
        """全部存定的日子，形状与 `/portfolio` 的 `pnl.daily[]` 一行相同"""
        with self.pool.connection() as conn:
            rows = conn.execute(f"SELECT {_DAILY_COLS} FROM daily_pnl ORDER BY day").fetchall()
        return {row["day"].isoformat(): {
            "date": row["day"].isoformat(),
            "spot_usd": float(row["spot_usd"]),
            "stock_usd": float(row["stock_usd"]),
            "settled_usd": float(row["settled_usd"]),
            "settled_parts": row["settled_parts"],
            "earn_usd": float(row["earn_usd"]),
            "interest_usd": float(row["interest_usd"]),
            "pnl_usd": float(row["pnl_usd"]),
            "known": True,
        } for row in rows}

    def freeze(self, row: dict, *, earn_method: str, method: str) -> bool:
        """存定一天。已经存定的不动（返回 False）"""
        with self.pool.connection() as conn:
            got = conn.execute(
                "INSERT INTO daily_pnl (day, spot_usd, stock_usd, settled_usd, settled_parts, "
                "earn_usd, interest_usd, pnl_usd, earn_method, method) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (day) DO NOTHING RETURNING day",
                (row["date"], row["spot_usd"], row["stock_usd"], row["settled_usd"],
                 None if row["settled_parts"] is None
                 else json.dumps(row["settled_parts"], ensure_ascii=False),
                 row["earn_usd"], row["interest_usd"], row["pnl_usd"], earn_method,
                 method)).fetchone()
        return got is not None

    # --- 原始记录 -------------------------------------------------------------

    def upsert_records(self, source: str,
                       items: Iterable[tuple[str, datetime | None, Any]]) -> int:
        """写入一批记录，返回新增或内容有变的条数。同一条内容没变就什么都不做"""
        batch = [(source, record_id, at, json.dumps(payload, ensure_ascii=False, sort_keys=True))
                 for record_id, at, payload in items]
        if not batch:
            return 0
        changed = 0
        with self.pool.connection() as conn:
            with conn.cursor() as cur:
                for args in batch:
                    cur.execute(
                        "INSERT INTO binance_records (source, record_id, occurred_at, payload) "
                        "VALUES (%s,%s,%s,%s) ON CONFLICT (source, record_id) DO UPDATE SET "
                        "payload = EXCLUDED.payload, occurred_at = EXCLUDED.occurred_at, "
                        "updated_at = now() "
                        "WHERE binance_records.payload IS DISTINCT FROM EXCLUDED.payload "
                        "RETURNING record_id", args)
                    changed += cur.fetchone() is not None
        return changed

    def record_count(self, source: str) -> int:
        with self.pool.connection() as conn:
            return int(conn.execute("SELECT count(*) AS n FROM binance_records WHERE source = %s",
                                    (source,)).fetchone()["n"])


# --- 日历：存定的盖过现算的 -------------------------------------------------------


def merge_daily(live: list[dict], frozen: dict[str, dict],
                closes: dict[str, float]) -> list[dict]:
    """把存定的日子并进现算的日历。

    - 窗口里存定了的那天用存定的数，**不用现算的**——那正是存定的意义；
    - 比窗口更早的存定日子接在前面，日历因此能看到 90 天以前；
    - 每天带上收盘净值（`nav_close_usd`，含现金），没有收盘快照的是 null；
    - 今天永远是现算的：它还没结束，不会被存定。

    每一行加 `frozen`，说明这个数是存定的还是现算的。
    """
    first = live[0]["date"] if live else None
    older = [{**row, "frozen": True} for day, row in sorted(frozen.items())
             if first is None or day < first]
    merged = older + [({**frozen[row["date"]], "frozen": True} if row["date"] in frozen
                       else {**row, "frozen": False}) for row in live]
    return [{**row, "nav_close_usd": closes.get(row["date"])} for row in merged]


# --- 原始记录从哪来、id 怎么取 ----------------------------------------------------


def _ms(value: Any) -> datetime | None:
    iso = ms_to_iso(value)
    return datetime.fromisoformat(iso) if iso else None


def _apply_time(row: dict) -> datetime | None:
    """提现的时间是字符串（"2026-09-24 08:00:00"，UTC），不是毫秒"""
    raw = row.get("completeTime") or row.get("applyTime")
    if isinstance(raw, (int, float)):
        return _ms(raw)
    if isinstance(raw, str) and raw:
        try:
            return datetime.fromisoformat(raw.replace(" ", "T")).replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _rows(key: str) -> Callable[[Any], list[dict]]:
    def pick(payload: Any) -> list[dict]:
        if isinstance(payload, dict):
            rows = payload.get(key)
            return rows if isinstance(rows, list) else []
        return payload if isinstance(payload, list) else []
    return pick


def _plain(payload: Any) -> list[dict]:
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    return payload if isinstance(payload, list) else []


def _id(*fields: str) -> Callable[[dict, str], str | None]:
    """第一个有值的字段当 id；都没有就退回"时间 + 其余字段"的组合（样本里常缺 id）"""
    def make(row: dict, _key: str) -> str | None:
        for field in fields:
            if row.get(field) not in (None, ""):
                return str(row[field])
        return None
    return make


def _income_id(row: dict, _key: str) -> str:
    # tranId 在同一笔成交的平仓盈亏与手续费之间可能相同，带上类型与币种才唯一
    base = row.get("tranId")
    if base in (None, ""):
        base = f"t{row.get('time')}:{row.get('income')}"
    return f"{base}:{row.get('incomeType')}:{row.get('asset')}:{row.get('symbol') or ''}"


def _deposit_id(row: dict, _key: str) -> str:
    if row.get("id") not in (None, ""):
        return str(row["id"])
    return f"{row.get('txId')}:{row.get('coin')}:{row.get('insertTime')}"


def _trade_id(row: dict, key: str) -> str | None:
    # 现货成交 id 只在同一个交易对内唯一；交易对从缓存键里来（trades.BNBUSDT）
    symbol = row.get("symbol") or key.split(".", 1)[-1]
    return None if row.get("id") in (None, "") else f"{symbol}:{row['id']}"


@dataclass(frozen=True)
class RecordSource:
    name: str
    keys: tuple[str, ...]          # 缓存键：以 ":" 或 "." 结尾的是前缀，其余必须完全相同
    rows: Callable[[Any], list[dict]]
    record_id: Callable[[dict, str], str | None]
    occurred_at: Callable[[dict], datetime | None]

    def matches(self, key: str) -> bool:
        return any(key.startswith(k) if k.endswith((":", ".")) else key == k for k in self.keys)


RECORD_SOURCES: tuple[RecordSource, ...] = (
    RecordSource("futures_income", ("income", "ledger.income:"), _plain, _income_id,
                 lambda r: _ms(r.get("time"))),
    RecordSource("margin_interest", ("flows.interest", "ledger.interest:"), _plain,
                 _id("txId"), lambda r: _ms(r.get("interestAccuredTime")
                                             or r.get("interestAccruedTime"))),
    RecordSource("deposits", ("transfers.deposits", "ledger.deposits:"), _plain, _deposit_id,
                 lambda r: _ms(r.get("insertTime"))),
    RecordSource("withdrawals", ("transfers.withdrawals", "ledger.withdrawals:"), _plain,
                 lambda r, k: str(r.get("id") or f"{r.get('txId')}:{r.get('coin')}:{r.get('applyTime')}"),
                 _apply_time),
    RecordSource("convert", ("flows.convert", "ledger.convert:"), _rows("list"), _id("orderId"),
                 lambda r: _ms(r.get("createTime"))),
    RecordSource("dust", ("flows.dust", "ledger.dust:"), _rows("userAssetDribblets"),
                 _id("transId"), lambda r: _ms(r.get("operateTime"))),
    RecordSource("wallet_transfers", ("ledger.transfer:",), _plain, _id("tranId"),
                 lambda r: _ms(r.get("timestamp"))),
    RecordSource("spot_trades", ("trades.",), _plain, _trade_id, lambda r: _ms(r.get("time"))),
    RecordSource("equity_trades", ("flows.equity_trades",), _plain, _id("executionId"),
                 lambda r: _ms(r.get("executionAt"))),
)

# 不经过缓存、由任务每天另取的派息记录。三类都没有现成的记录 id。
# 字段按 2026-10-03 生产账户的实际响应：活期每行 asset / productId / rewards / time / type，
# 同一时刻 REALTIME 与 BONUS 各一行；BFUSD 每天一行，只有 time / rewardsAmount /
# bfusdposition / annualPercentageRate，没有币种字段
REWARD_SOURCES: dict[str, Callable[[dict], str]] = {
    "flexible": lambda r: f"{r.get('time')}:{r.get('asset')}:{r.get('type')}:{r.get('productId') or ''}",
    "locked": lambda r: f"{r.get('positionId') or ''}:{r.get('time')}:{r.get('asset')}",
    "bfusd": lambda r: str(r.get("time")),
}


def extract_records(cached: Iterable[tuple[str, Any]]
                    ) -> dict[str, list[tuple[str, datetime | None, dict]]]:
    """从缓存的 (键, 内容) 里挑出要沉淀的记录，按来源分组。取不到 id 的行跳过"""
    out: dict[str, dict[str, tuple[str, datetime | None, dict]]] = {}
    for key, payload in cached:
        for source in RECORD_SOURCES:
            if not source.matches(key):
                continue
            bucket = out.setdefault(source.name, {})
            for row in source.rows(payload):
                if not isinstance(row, dict):
                    continue
                record_id = source.record_id(row, key)
                if record_id:
                    # 同一条记录可能出现在两个缓存键里（资产页 90 天、流水页 30 天）：取一份
                    bucket[record_id] = (record_id, source.occurred_at(row), row)
    return {name: list(rows.values()) for name, rows in out.items()}
