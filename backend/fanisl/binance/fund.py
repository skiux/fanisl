"""账户的出资与分配规则。管理员录入，存在主库，不碰 Binance。

console 把这个 Binance 账户当成一只小基金来记：账户有一个初始净值和起始日，
参与分配的用户各有出资（Invested Capital）和分配比例。两张表：

- `fund_settings`：整个账户只有一行——初始净值、起始日、现金。现金是交易所以外的
  钱，也是账户的真实资产：**净值 = 交易所内的资产 + 现金**，资产页显示的、盈亏和分配
  用的都是这一个数（2026-10-03 起不再区分"真实净值"与"显示的净值"）。
- `fund_members`：每个参与分配的用户一行，按 `users.id` 关联，删用户时连带删掉。

两张表都是覆盖写，所以另有 `fund_audit` 记下每一次改动（改之前、改之后、谁改的）。
它由触发器写，不经过这里的代码：手工 SQL、删用户连带删掉的那一行同样会留痕。
份额记账要知道"出资和比例是哪天变的"，覆盖写的两张表给不出这个，审计表从现在起给。
删除没有 `updated_by` 可用：经 `save_member` 删的，删之前把操作人写进会话变量
`fanisl.actor`；删用户连带删掉的那一行，操作人为空。

**Manager / Investor 与 admin / member 是两回事。** 后者是 console 的权限（能看什么、
能改什么，见 `auth/`），前者决定账户盈亏怎么分。管理员不参与分配：写接口拒绝给管理员
设这两个角色，读的时候也只认 `role='member'` 的用户——成员被升成管理员后，他那一行
留在表里但不再参与计算，降回成员又会回来。

一个人可以同时是 Manager 和 Investor。两个角色都没有就不是参与者，那一行直接删掉，
免得留着一份不参与计算、却还显示在那里的出资。

**分配怎么算不在这里**，在 `console/src/lib/fund.ts`：它要用资产页的净值和逐日
盈亏，这两样只在 `/portfolio` 的快照里。规则（2026-10-03 用户确认）：

    管理费   = Σ Manager 的 Management Fee × 初始净值 × 起始日以来的天数 / 365
    可分配   = 净值（含现金） − 初始净值 − 管理费
    盈利     = max(可分配, 0)：Manager 分 盈利 × Performance Fee，
               Investor 分 盈利 × (Invested Capital / 初始净值) × Investor Return
    亏损     = max(−可分配, 0)，每人承担 亏损 × Loss Allocation

亏损只按低于初始净值（加上管理费）的部分算：净值从高点回撤、但仍在初始净值之上时，
只是盈利变少，Loss Allocation 为 0 的人不会因此变成亏损。
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from psycopg_pool import ConnectionPool

# 建表、建触发器放在一个事务里，先拿一把事务级的锁：两个进程同时启动时，
# CREATE OR REPLACE FUNCTION / TRIGGER 并发执行会报 "tuple concurrently updated"
_SCHEMA = """
SELECT pg_advisory_xact_lock(hashtext('fanisl.fund_schema'));
CREATE TABLE IF NOT EXISTS fund_settings (
    id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    initial_nav_usd NUMERIC CHECK (initial_nav_usd > 0),
    inception_date  DATE,
    cash_usd        NUMERIC CHECK (cash_usd >= 0),
    updated_by      BIGINT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fund_members (
    user_id              BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_manager           BOOLEAN NOT NULL,
    is_investor          BOOLEAN NOT NULL,
    invested_capital_usd NUMERIC NOT NULL CHECK (invested_capital_usd >= 0),
    loss_allocation      NUMERIC NOT NULL CHECK (loss_allocation BETWEEN 0 AND 1),
    management_fee       NUMERIC NOT NULL CHECK (management_fee BETWEEN 0 AND 1),
    performance_fee      NUMERIC NOT NULL CHECK (performance_fee BETWEEN 0 AND 1),
    investor_return      NUMERIC NOT NULL CHECK (investor_return BETWEEN 0 AND 1),
    updated_by           BIGINT NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (is_manager OR is_investor)
);
CREATE TABLE IF NOT EXISTS fund_audit (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    table_name TEXT NOT NULL,
    op         TEXT NOT NULL,
    user_id    BIGINT,
    actor      BIGINT,
    old_row    JSONB,
    new_row    JSONB
);
CREATE INDEX IF NOT EXISTS idx_fund_audit_user ON fund_audit (user_id, at);
CREATE OR REPLACE FUNCTION fund_audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_row JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    new_row JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
    -- 原样再存一遍（只有 updated_at / updated_by 变了）不是改动
    IF TG_OP = 'UPDATE' AND old_row - 'updated_at' - 'updated_by'
                          = new_row - 'updated_at' - 'updated_by' THEN
        RETURN NULL;
    END IF;
    INSERT INTO fund_audit (table_name, op, user_id, actor, old_row, new_row)
    VALUES (TG_TABLE_NAME, TG_OP,
            (coalesce(new_row, old_row) ->> 'user_id')::bigint,
            coalesce(nullif(current_setting('fanisl.actor', true), '')::bigint,
                     (new_row ->> 'updated_by')::bigint),
            old_row, new_row);
    RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER fund_settings_audit AFTER INSERT OR UPDATE OR DELETE ON fund_settings
    FOR EACH ROW EXECUTE FUNCTION fund_audit_row();
CREATE OR REPLACE TRIGGER fund_members_audit AFTER INSERT OR UPDATE OR DELETE ON fund_members
    FOR EACH ROW EXECUTE FUNCTION fund_audit_row();
"""

_MEMBER_COLS = (
    "m.user_id, u.username, u.display_name, m.is_manager, m.is_investor, "
    "m.invested_capital_usd, m.loss_allocation, m.management_fee, "
    "m.performance_fee, m.investor_return, m.updated_at"
)


class FundStore:
    def __init__(self, pool: ConnectionPool) -> None:
        self.pool = pool
        with pool.connection() as conn:
            conn.execute(_SCHEMA)

    def settings(self) -> dict | None:
        with self.pool.connection() as conn:
            return conn.execute(
                "SELECT initial_nav_usd, inception_date, cash_usd, updated_at "
                "FROM fund_settings").fetchone()

    def save_settings(self, *, initial_nav_usd: Decimal | None, inception_date: date | None,
                      cash_usd: Decimal | None, updated_by: int) -> dict:
        with self.pool.connection() as conn:
            return conn.execute(
                "INSERT INTO fund_settings (initial_nav_usd, inception_date, cash_usd, updated_by) "
                "VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (id) DO UPDATE SET initial_nav_usd = EXCLUDED.initial_nav_usd, "
                "inception_date = EXCLUDED.inception_date, cash_usd = EXCLUDED.cash_usd, "
                "updated_by = EXCLUDED.updated_by, updated_at = now() "
                "RETURNING initial_nav_usd, inception_date, cash_usd, updated_at",
                (initial_nav_usd, inception_date, cash_usd, updated_by)).fetchone()

    def members(self, user_id: int | None = None) -> list[dict]:
        """参与分配的成员；给了 user_id 就只要那一个（成员只能看见自己）。"""
        where = "WHERE u.role = 'member'" + (" AND m.user_id = %s" if user_id is not None else "")
        with self.pool.connection() as conn:
            return conn.execute(
                f"SELECT {_MEMBER_COLS} FROM fund_members m JOIN users u ON u.id = m.user_id "
                f"{where} ORDER BY m.user_id",
                (user_id,) if user_id is not None else ()).fetchall()

    def management_fee_total(self) -> Decimal:
        """全部 Manager 的管理费率之和。成员算自己的账户也要它（管理费先从账户盈亏里扣）。"""
        with self.pool.connection() as conn:
            row = conn.execute(
                "SELECT coalesce(sum(m.management_fee), 0) AS total FROM fund_members m "
                "JOIN users u ON u.id = m.user_id WHERE u.role = 'member' AND m.is_manager"
            ).fetchone()
        return row["total"]

    def user_role(self, user_id: int) -> str | None:
        with self.pool.connection() as conn:
            row = conn.execute("SELECT role FROM users WHERE id = %s", (user_id,)).fetchone()
        return row["role"] if row else None

    def save_member(self, user_id: int, *, is_manager: bool, is_investor: bool,
                    invested_capital_usd: Decimal, loss_allocation: Decimal,
                    management_fee: Decimal, performance_fee: Decimal,
                    investor_return: Decimal, updated_by: int) -> dict | None:
        """两个角色都没有就删掉这一行，返回 None。"""
        with self.pool.connection() as conn:
            if not (is_manager or is_investor):
                # 删除没有 NEW.updated_by，审计触发器从这里读操作人；只在本事务内有效
                conn.execute("SELECT set_config('fanisl.actor', %s, true)", (str(updated_by),))
                conn.execute("DELETE FROM fund_members WHERE user_id = %s", (user_id,))
                return None
            conn.execute(
                "INSERT INTO fund_members (user_id, is_manager, is_investor, invested_capital_usd, "
                "loss_allocation, management_fee, performance_fee, investor_return, updated_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager, "
                "is_investor = EXCLUDED.is_investor, "
                "invested_capital_usd = EXCLUDED.invested_capital_usd, "
                "loss_allocation = EXCLUDED.loss_allocation, "
                "management_fee = EXCLUDED.management_fee, "
                "performance_fee = EXCLUDED.performance_fee, "
                "investor_return = EXCLUDED.investor_return, "
                "updated_by = EXCLUDED.updated_by, updated_at = now()",
                (user_id, is_manager, is_investor, invested_capital_usd, loss_allocation,
                 management_fee, performance_fee, investor_return, updated_by))
            return conn.execute(
                f"SELECT {_MEMBER_COLS} FROM fund_members m JOIN users u ON u.id = m.user_id "
                f"WHERE m.user_id = %s", (user_id,)).fetchone()
