"""手工录入的现货成本均价。

## 为什么需要它

`costbasis.py` 的成交重放只能给出"在这个账户里买过的那部分"的成本。剩下的进来
方式一律没有价格：钱包划转、理财派息、小额兑换、从别处充值进来的币——`myTrades`
里从来没有它们。重放因此报 `unpriced_qty`，那部分不计入盈亏，界面上的现货未实现
就比实际小一截（实测持有 6.712 BNB，只有 1 个有据可依）。

充值那条路本来能靠"到账时市价"补上，但 `capital/deposit/hisrec` 只回 90 天，
更早的充值永远查不回来。**缺的是历史，不是算法**——那就让人把它填上。

## 口径

一条记录 = "我这个币的持仓均价是 X 美元"，覆盖**当前全部持有量**：

    未实现 = 持有量 × (现价 − 录入均价)

所以它**取代**重放算出来的均价，而不是与之相加。理由是录入的人报的是整个仓位的
成本，不是某一段；两者混在一起需要说清"这个均价管哪部分数量"，那是给自己找麻烦。

**只改未实现，不改已实现。** 手工均价说的是"现在手上这些花了多少"，回答不了
过去那些卖出是赚是赔——真按它去重算已实现，等于假设历史上每一笔卖出都发生在
同一个成本上，那是编的。已实现仍然只认重放。

**每次加仓后都会过期，而且不会自己报警。** 所以记录里存了 `updated_at` 与录入时
的持有量 `qty_at_entry`：界面拿它和当前持有量比，对不上就说这条该更新了。
只存一个价格的话，加仓之后它会一直安安静静地给错数。
"""

from __future__ import annotations

from psycopg_pool import ConnectionPool

_SCHEMA = """
CREATE TABLE IF NOT EXISTS spot_cost_basis (
    asset         TEXT PRIMARY KEY,
    avg_cost_usd  DOUBLE PRECISION NOT NULL,
    qty_at_entry  DOUBLE PRECISION,
    note          TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    TEXT NOT NULL DEFAULT ''
);
"""

_COLS = "asset, avg_cost_usd, qty_at_entry, note, updated_at, updated_by"


def normalize_asset(asset: str) -> str:
    """`bnb ` → `BNB`。Binance 的币种代码一律大写，大小写不一致会存成两行。"""
    return asset.strip().upper()


class CostBasisStore:
    def __init__(self, pool: ConnectionPool) -> None:
        self._pool = pool
        with pool.connection() as conn:
            conn.execute(_SCHEMA)

    def list(self) -> list[dict]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                f"SELECT {_COLS} FROM spot_cost_basis ORDER BY asset").fetchall()
        return [dict(row) for row in rows]

    def overrides(self) -> dict[str, float]:
        """给 `summarize` 用的 asset → 均价。取数路径上每次都要读，只取两列。"""
        with self._pool.connection() as conn:
            rows = conn.execute("SELECT asset, avg_cost_usd FROM spot_cost_basis").fetchall()
        return {row["asset"]: float(row["avg_cost_usd"]) for row in rows}

    def set(self, asset: str, *, avg_cost_usd: float, qty_at_entry: float | None,
            note: str = "", by: str = "") -> dict:
        with self._pool.connection() as conn:
            row = conn.execute(
                f"""INSERT INTO spot_cost_basis
                        (asset, avg_cost_usd, qty_at_entry, note, updated_by)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (asset) DO UPDATE SET
                        avg_cost_usd = EXCLUDED.avg_cost_usd,
                        qty_at_entry = EXCLUDED.qty_at_entry,
                        note         = EXCLUDED.note,
                        updated_by   = EXCLUDED.updated_by,
                        updated_at   = now()
                    RETURNING {_COLS}""",
                (normalize_asset(asset), avg_cost_usd, qty_at_entry, note, by),
            ).fetchone()
        return dict(row)

    def delete(self, asset: str) -> bool:
        with self._pool.connection() as conn:
            cur = conn.execute("DELETE FROM spot_cost_basis WHERE asset = %s",
                               (normalize_asset(asset),))
        return cur.rowcount > 0
