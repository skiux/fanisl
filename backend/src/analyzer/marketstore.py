"""市场数据持久化：时间序列(metric_samples) + 催化剂列表(catalyst_items) + 采集日志。

与对话存储 storage.py 分离（不同关注点），共用同一个 SQLite 文件。单用户本地工具，
每次操作开新连接。所有写入 best-effort 由调用方保证；这里只管表与读写。
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterator

GLOBAL = "GLOBAL"  # scope=global 的 symbol 占位

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metric_samples (
    scope   TEXT NOT NULL,           -- symbol | global
    symbol  TEXT NOT NULL,           -- 币种，全市场指标记 GLOBAL
    metric  TEXT NOT NULL,
    ts      TEXT NOT NULL,           -- ISO8601 UTC（采集周期时间）
    value   REAL NOT NULL,
    PRIMARY KEY (scope, symbol, metric, ts)
);
CREATE INDEX IF NOT EXISTS idx_samples_q ON metric_samples(symbol, metric, ts);

CREATE TABLE IF NOT EXISTS catalyst_items (
    kind        TEXT NOT NULL,       -- unlock | macro | news
    symbol      TEXT NOT NULL,       -- 币种或 GLOBAL
    event_date  TEXT,                -- 事件/发布日期
    title       TEXT NOT NULL,
    payload_json TEXT,
    fetched_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalyst_q ON catalyst_items(kind, symbol);

CREATE TABLE IF NOT EXISTS collection_runs (
    job        TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    note       TEXT
);
"""


@dataclass
class Sample:
    scope: str
    symbol: str
    metric: str
    value: float


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class MarketStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # --- 时间序列 --------------------------------------------------------

    def write_samples(self, samples: list[Sample], ts: str) -> int:
        """批量 upsert 样本（同 ts 重复则覆盖）。返回写入条数。"""
        if not samples:
            return 0
        rows = [(s.scope, s.symbol, s.metric, ts, float(s.value)) for s in samples]
        with self._conn() as conn:
            conn.executemany(
                "INSERT INTO metric_samples(scope, symbol, metric, ts, value) "
                "VALUES (?,?,?,?,?) "
                "ON CONFLICT(scope, symbol, metric, ts) DO UPDATE SET value=excluded.value",
                rows,
            )
        return len(rows)

    def get_series(
        self, symbol: str, metrics: list[str], since: str | None = None
    ) -> dict[str, list[dict]]:
        """取 {metric: [{ts, value}...]}（按时间升序）。"""
        if not metrics:
            return {}
        out: dict[str, list[dict]] = {m: [] for m in metrics}
        ph = ",".join("?" * len(metrics))
        sql = (
            f"SELECT metric, ts, value FROM metric_samples "
            f"WHERE symbol=? AND metric IN ({ph})"
        )
        params: list = [symbol, *metrics]
        if since:
            sql += " AND ts >= ?"
            params.append(since)
        sql += " ORDER BY ts ASC"
        with self._conn() as conn:
            for r in conn.execute(sql, params).fetchall():
                out[r["metric"]].append({"ts": r["ts"], "value": r["value"]})
        return out

    def latest_metrics(self, symbol: str) -> dict[str, dict]:
        """某 symbol 每个 metric 的最新一条 {metric: {ts, value}}。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT metric, ts, value FROM metric_samples WHERE symbol=? "
                "ORDER BY metric, ts DESC",
                (symbol,),
            ).fetchall()
        out: dict[str, dict] = {}
        for r in rows:
            if r["metric"] not in out:  # 已按 ts DESC，首次即最新
                out[r["metric"]] = {"ts": r["ts"], "value": r["value"]}
        return out

    # --- 催化剂列表 ------------------------------------------------------

    def replace_catalysts(self, kind: str, symbol: str, items: list[dict]) -> int:
        """先删 (kind, symbol) 的旧记录再插新 = 最新快照语义。"""
        ts = _now()
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM catalyst_items WHERE kind=? AND symbol=?", (kind, symbol)
            )
            conn.executemany(
                "INSERT INTO catalyst_items(kind, symbol, event_date, title, payload_json, fetched_at) "
                "VALUES (?,?,?,?,?,?)",
                [
                    (
                        kind,
                        symbol,
                        it.get("event_date"),
                        it.get("title") or "",
                        json.dumps(it.get("payload"), ensure_ascii=False)
                        if it.get("payload") is not None
                        else None,
                        ts,
                    )
                    for it in items
                ],
            )
        return len(items)

    def get_catalysts(self, symbol: str | None = None) -> list[dict]:
        with self._conn() as conn:
            if symbol:
                rows = conn.execute(
                    "SELECT kind, symbol, event_date, title, payload_json, fetched_at "
                    "FROM catalyst_items WHERE symbol IN (?, ?) ORDER BY event_date ASC",
                    (symbol, GLOBAL),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT kind, symbol, event_date, title, payload_json, fetched_at "
                    "FROM catalyst_items ORDER BY event_date ASC"
                ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["payload"] = json.loads(d.pop("payload_json")) if d["payload_json"] else None
            out.append(d)
        return out

    # --- 采集日志 --------------------------------------------------------

    def log_run(self, job: str, ok: bool, note: str = "") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO collection_runs(job, started_at, ok, note) VALUES (?,?,?,?)",
                (job, _now(), 1 if ok else 0, note),
            )

    def status(self) -> list[dict]:
        """每个 job 的最近一次运行（按 rowid 取最新，避免同秒时间戳碰撞）。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT job, started_at, ok, note FROM collection_runs "
                "WHERE rowid IN (SELECT MAX(rowid) FROM collection_runs GROUP BY job) "
                "ORDER BY job"
            ).fetchall()
        return [dict(r) for r in rows]
