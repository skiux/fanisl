"""按来源的 TTL 缓存 + 降级语义。

**为什么必须有缓存**：Binance 的 IP 权重上限是 6000/分钟，而资产台一次完整刷新
（尤其流水那一页：八个端点、划转还要按 type 逐个问）的权重是五位数。没有缓存的话，
两三个人同时开着页面就会把预算打满，然后**所有**来源一起 429——一个页面把别的页面
也拖垮。

**降级语义**（前端那套"按来源分组降级"的后端一半）：
- 新鲜 → 直接用，`status=ok`，`as_of` 是取数时刻。
- 过期但取数成功 → 用新的。
- 过期且取数失败 → **回落到旧数据**，但 `status` 记成真实的失败原因、`as_of` 仍是
  旧数据的时刻。前端据此把这一块蒙上 `.veiled` 并标红，而不是假装它是当前值。
- 从来没成功过 → payload 为 None，前端留空。**不拿 0 顶替**——0 是一个有效余额。
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from psycopg_pool import ConnectionPool

from .client import BinanceError

_SCHEMA = """
CREATE TABLE IF NOT EXISTS binance_cache (
    source_key TEXT PRIMARY KEY,
    payload    JSONB,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status     TEXT NOT NULL DEFAULT 'ok',
    detail     TEXT
);
"""


@dataclass(frozen=True)
class SourceResult:
    """一个来源的取数结果：数据 + 它现在处于什么状态。

    与 console 契约里的 SourceState 一一对应。payload 为 None 表示"没有可用数据"，
    与"数据是 0"是两回事。
    """
    key: str
    payload: Any
    status: str          # ok | unreachable | unauthorized | rate_limited | unsupported
    as_of: datetime | None
    detail: str | None

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_state(self) -> dict:
        return {
            "key": self.key,
            "status": self.status,
            "as_of": self.as_of.isoformat() if self.as_of else None,
            "detail": self.detail,
        }


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SourceCache:
    def __init__(self, pool: ConnectionPool) -> None:
        self.pool = pool
        with pool.connection() as conn:
            conn.execute(_SCHEMA)

    def read(self, key: str) -> dict | None:
        with self.pool.connection() as conn:
            row = conn.execute(
                "SELECT payload, fetched_at, status, detail FROM binance_cache "
                "WHERE source_key = %s", (key,)).fetchone()
        if row is not None and row["fetched_at"] is not None:
            # psycopg 按会话时区还原 timestamptz（本机是 +08:00），而新取的那条是 UTC。
            # 同一时刻两种写法会让接口输出的时间戳不齐整，统一归到 UTC。
            row["fetched_at"] = row["fetched_at"].astimezone(timezone.utc)
        return row

    def write(self, key: str, payload: Any, *, status: str = "ok",
              detail: str | None = None) -> datetime:
        at = _now()
        with self.pool.connection() as conn:
            conn.execute(
                "INSERT INTO binance_cache(source_key, payload, fetched_at, status, detail) "
                "VALUES (%s,%s,%s,%s,%s) "
                "ON CONFLICT (source_key) DO UPDATE SET "
                "  payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at, "
                "  status = EXCLUDED.status, detail = EXCLUDED.detail",
                (key, json.dumps(payload, ensure_ascii=False), at, status, detail))
        return at

    def note_failure(self, key: str, status: str, detail: str) -> None:
        """记下失败，但**不覆盖 payload 与 fetched_at**——旧数据还要用来降级显示。"""
        with self.pool.connection() as conn:
            conn.execute(
                "INSERT INTO binance_cache(source_key, payload, status, detail) "
                "VALUES (%s, NULL, %s, %s) "
                "ON CONFLICT (source_key) DO UPDATE SET "
                "  status = EXCLUDED.status, detail = EXCLUDED.detail",
                (key, status, detail))

    def invalidate(self, prefix: str = "") -> int:
        with self.pool.connection() as conn:
            cur = conn.execute("DELETE FROM binance_cache WHERE source_key LIKE %s",
                               (f"{prefix}%",))
            return cur.rowcount


def fetch(cache: SourceCache, key: str, ttl_s: int, fn: Callable[[], Any], *,
          force: bool = False) -> SourceResult:
    """取一个来源：先看缓存，过期才真调，失败回落到旧数据。"""
    cached = cache.read(key)
    if not force and cached is not None and cached["payload"] is not None:
        age = _now() - cached["fetched_at"]
        if age < timedelta(seconds=ttl_s) and cached["status"] == "ok":
            return SourceResult(key, cached["payload"], "ok", cached["fetched_at"], None)

    try:
        payload = fn()
    except BinanceError as e:
        cache.note_failure(key, e.kind, e.detail)
        # 有旧数据就带着旧时刻返回——前端会把它蒙上并标出真实原因
        if cached is not None and cached["payload"] is not None:
            return SourceResult(key, cached["payload"], e.kind, cached["fetched_at"], e.detail)
        return SourceResult(key, None, e.kind, None, e.detail)

    at = cache.write(key, payload)
    return SourceResult(key, payload, "ok", at, None)


def fetch_all(cache: SourceCache, jobs: list[tuple[str, int, Callable[[], Any]]], *,
              force: bool = False, never_force: frozenset[str] = frozenset(),
              workers: int = 6) -> dict[str, SourceResult]:
    """并发取多个来源。

    串行会很慢——资产页十来个端点、流水页几十个。并发数**故意开得小**（6）：
    Binance 的权重是按 IP 算的，一口气打几十个并发只会更快撞上 429，
    而 429 之后所有来源一起坏，比慢几秒糟得多。

    `never_force` 是给贵的来源留的护栏：日快照单次权重 2400，一分钟预算才 6000。
    用户连点几下"重新取数"就能把预算打空，然后**所有**页面一起 429。这类来源本身
    是日频数据，强制刷新对它没有意义，所以直接不让 force 穿透。
    """
    if not jobs:
        return {}
    with ThreadPoolExecutor(max_workers=min(workers, len(jobs))) as pool:
        futures = {
            key: pool.submit(fetch, cache, key, ttl, fn,
                             force=force and key not in never_force)
            for key, ttl, fn in jobs
        }
        return {key: future.result() for key, future in futures.items()}
