"""账户规则：管理员录入初始净值、现金与每个成员的出资和比例。

两件事必须由服务端保证，前端藏起来不算数：成员只能拿到自己那一行；管理员不参与分配。
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from fanisl.binance import routes
from fanisl.binance.fund import FundStore

MEMBER = {
    "is_manager": True, "is_investor": True, "invested_capital_usd": 20000,
    "loss_allocation": 1, "management_fee": 0.02, "performance_fee": 0.3,
    "investor_return": 0.1,
}


@pytest.fixture
def fund(pool, auth_store):
    # auth_store 已经 TRUNCATE users … CASCADE，fund_members 跟着清空
    store = FundStore(pool)
    with pool.connection() as conn:
        conn.execute("TRUNCATE fund_settings, fund_audit RESTART IDENTITY")
    return store


def client_as(fund, user: dict) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def who(request: Request, call_next):
        request.state.user = user
        return await call_next(request)

    app.include_router(routes.build_router(object(), fund))
    return TestClient(app)


def make_users(auth_store):
    admin = auth_store.create_user("boss", "x", role="admin")
    alice = auth_store.create_user("alice", "x", display_name="Alice")
    bob = auth_store.create_user("bob", "x")
    return admin, alice, bob


def test_admin_saves_settings_and_members_and_reads_them_all(fund, auth_store):
    admin, alice, bob = make_users(auth_store)
    client = client_as(fund, admin)

    saved = client.put("/admin/fund", json={
        "initial_nav_usd": 100000, "inception_date": "2026-09-01", "cash_usd": 2500,
    })
    assert saved.status_code == 200
    assert saved.json()["settings"]["initial_nav_usd"] == 100000.0
    assert saved.json()["settings"]["inception_date"] == "2026-09-01"

    assert client.put(f"/admin/fund/members/{alice['id']}", json=MEMBER).status_code == 200
    assert client.put(f"/admin/fund/members/{bob['id']}", json={
        **MEMBER, "is_manager": False, "invested_capital_usd": 80000, "loss_allocation": 0,
        "investor_return": 0.7,
    }).status_code == 200

    body = client.get("/portfolio/fund").json()
    assert body["settings"] == {
        "initial_nav_usd": 100000.0, "inception_date": "2026-09-01", "cash_usd": 2500.0,
        "updated_at": body["settings"]["updated_at"],
    }
    assert [row["username"] for row in body["members"]] == ["alice", "bob"]
    assert body["members"][0]["display_name"] == "Alice"
    # 不是 Manager 的人，管理费与业绩报酬存成 0，不留着继续分钱
    assert body["members"][1]["management_fee"] == 0.0
    assert body["members"][1]["performance_fee"] == 0.0
    assert body["management_fee_total"] == pytest.approx(0.02)


def test_member_only_sees_own_row(fund, auth_store):
    admin, alice, bob = make_users(auth_store)
    fund.save_member(alice["id"], **{k: Decimal(str(v)) if not isinstance(v, bool) else v
                                     for k, v in MEMBER.items()}, updated_by=admin["id"])
    fund.save_member(bob["id"], **{**{k: Decimal(str(v)) if not isinstance(v, bool) else v
                                      for k, v in MEMBER.items()}, "is_manager": False},
                     updated_by=admin["id"])

    body = client_as(fund, bob).get("/portfolio/fund").json()
    assert [row["username"] for row in body["members"]] == ["bob"]
    # 管理费合计照给：成员算自己的账户也要先扣掉它
    assert body["management_fee_total"] == pytest.approx(0.02)

    outsider = auth_store.create_user("carol", "x")
    assert client_as(fund, outsider).get("/portfolio/fund").json()["members"] == []


def test_admins_cannot_join_and_members_cannot_write(fund, auth_store):
    admin, alice, _ = make_users(auth_store)
    as_admin = client_as(fund, admin)
    assert as_admin.put(f"/admin/fund/members/{admin['id']}", json=MEMBER).status_code == 409
    assert as_admin.put("/admin/fund/members/999999", json=MEMBER).status_code == 404

    as_member = client_as(fund, alice)
    assert as_member.put("/admin/fund", json={"cash_usd": 1}).status_code == 403
    assert as_member.put(f"/admin/fund/members/{alice['id']}", json=MEMBER).status_code == 403
    assert fund.settings() is None


def test_out_of_range_values_are_rejected(fund, auth_store):
    admin, alice, _ = make_users(auth_store)
    client = client_as(fund, admin)
    assert client.put("/admin/fund", json={"initial_nav_usd": 0}).status_code == 422
    assert client.put("/admin/fund", json={"cash_usd": -1}).status_code == 422
    for key in ("loss_allocation", "management_fee", "performance_fee", "investor_return"):
        assert client.put(f"/admin/fund/members/{alice['id']}",
                          json={**MEMBER, key: 1.2}).status_code == 422
    assert client.put(f"/admin/fund/members/{alice['id']}",
                      json={**MEMBER, "invested_capital_usd": -5}).status_code == 422


def test_dropping_both_roles_removes_the_member(fund, auth_store):
    admin, alice, _ = make_users(auth_store)
    client = client_as(fund, admin)
    client.put(f"/admin/fund/members/{alice['id']}", json=MEMBER)
    response = client.put(f"/admin/fund/members/{alice['id']}",
                          json={**MEMBER, "is_manager": False, "is_investor": False})
    assert response.json() == {"member": None}
    assert fund.members() == []


def test_promoted_member_drops_out_and_deleted_user_takes_the_row(fund, auth_store):
    admin, alice, bob = make_users(auth_store)
    client = client_as(fund, admin)
    client.put(f"/admin/fund/members/{alice['id']}", json=MEMBER)
    client.put(f"/admin/fund/members/{bob['id']}", json=MEMBER)

    auth_store.set_role(alice["id"], "admin")
    assert [row["username"] for row in fund.members()] == ["bob"]
    assert fund.management_fee_total() == Decimal("0.02")

    auth_store.delete_user(bob["id"])
    assert fund.members() == []


def test_settings_can_be_cleared(fund, auth_store):
    admin, _, _ = make_users(auth_store)
    fund.save_settings(initial_nav_usd=Decimal(100), inception_date=date(2026, 9, 1),
                       cash_usd=Decimal(5), updated_by=admin["id"])
    fund.save_settings(initial_nav_usd=Decimal(100), inception_date=date(2026, 9, 1),
                       cash_usd=None, updated_by=admin["id"])
    assert fund.settings()["cash_usd"] is None


def audit(pool) -> list[tuple]:
    with pool.connection() as conn:
        rows = conn.execute("SELECT table_name, op, user_id, actor, old_row, new_row "
                            "FROM fund_audit ORDER BY id").fetchall()
    return [(r["table_name"], r["op"], r["user_id"], r["actor"], r["old_row"], r["new_row"])
            for r in rows]


def test_every_change_to_the_rules_is_audited(fund, pool, auth_store):
    """两张表覆盖写；份额记账要知道出资和比例哪天变的，靠这张审计表。"""
    admin, alice, bob = make_users(auth_store)
    fund.save_settings(initial_nav_usd=Decimal(100000), inception_date=date(2026, 9, 1),
                       cash_usd=Decimal(0), updated_by=admin["id"])
    # 原样再存一遍不算改动
    fund.save_settings(initial_nav_usd=Decimal(100000), inception_date=date(2026, 9, 1),
                       cash_usd=Decimal(0), updated_by=admin["id"])
    fund.save_settings(initial_nav_usd=Decimal(100000), inception_date=date(2026, 9, 1),
                       cash_usd=Decimal(2500), updated_by=admin["id"])
    member = {k: Decimal(str(v)) if not isinstance(v, bool) else v for k, v in MEMBER.items()}
    fund.save_member(alice["id"], **member, updated_by=admin["id"])
    fund.save_member(alice["id"], **{**member, "invested_capital_usd": Decimal(30000)},
                     updated_by=admin["id"])
    fund.save_member(bob["id"], **member, updated_by=admin["id"])
    # 两个角色都去掉 = 删掉那一行；删除没有 updated_by，操作人从会话变量来
    fund.save_member(bob["id"], **{**member, "is_manager": False, "is_investor": False},
                     updated_by=admin["id"])
    # 删用户连带删掉的那一行同样留痕，只是不知道是谁删的
    auth_store.delete_user(alice["id"])

    rows = audit(pool)
    assert [(t, op, uid, actor) for t, op, uid, actor, _, _ in rows] == [
        ("fund_settings", "INSERT", None, admin["id"]),
        ("fund_settings", "UPDATE", None, admin["id"]),
        ("fund_members", "INSERT", alice["id"], admin["id"]),
        ("fund_members", "UPDATE", alice["id"], admin["id"]),
        ("fund_members", "INSERT", bob["id"], admin["id"]),
        ("fund_members", "DELETE", bob["id"], admin["id"]),
        ("fund_members", "DELETE", alice["id"], None),
    ]
    _, _, _, _, old, new = rows[3]
    assert (old["invested_capital_usd"], new["invested_capital_usd"]) == (20000, 30000)
    assert rows[1][4]["cash_usd"] == 0 and rows[1][5]["cash_usd"] == 2500
    assert rows[6][5] is None and rows[6][4]["invested_capital_usd"] == 30000

