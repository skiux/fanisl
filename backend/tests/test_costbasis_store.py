"""人手录入的现货持仓均价。

只验存取与规范化——口径（录了之后怎么算盈亏）在 test_costbasis.py 里，那一组不碰库。
"""

import pytest


def test_set_and_list_roundtrip(cost_basis_store):
    cost_basis_store.set("BNB", avg_cost_usd=612.5, qty_at_entry=6.712,
                         note="划转进来的", by="alice")
    rows = cost_basis_store.list()
    assert len(rows) == 1
    row = rows[0]
    assert row["asset"] == "BNB"
    assert row["avg_cost_usd"] == pytest.approx(612.5)
    assert row["qty_at_entry"] == pytest.approx(6.712)
    assert row["note"] == "划转进来的" and row["updated_by"] == "alice"
    assert row["updated_at"] is not None


def test_asset_is_upper_cased(cost_basis_store):
    """大小写不统一会存成两行，取数时只有一行生效，另一行看着像"改了没生效"。"""
    cost_basis_store.set(" bnb ", avg_cost_usd=600.0, qty_at_entry=None)
    cost_basis_store.set("BNB", avg_cost_usd=650.0, qty_at_entry=None)
    rows = cost_basis_store.list()
    assert [r["asset"] for r in rows] == ["BNB"]
    assert rows[0]["avg_cost_usd"] == pytest.approx(650.0)


def test_overrides_is_the_shape_summarize_wants(cost_basis_store):
    cost_basis_store.set("BNB", avg_cost_usd=600.0, qty_at_entry=None)
    cost_basis_store.set("XAU", avg_cost_usd=2400.0, qty_at_entry=None)
    assert cost_basis_store.overrides() == {"BNB": 600.0, "XAU": 2400.0}


def test_delete_reports_whether_anything_was_there(cost_basis_store):
    cost_basis_store.set("BNB", avg_cost_usd=600.0, qty_at_entry=None)
    assert cost_basis_store.delete("bnb") is True
    assert cost_basis_store.delete("BNB") is False
    assert cost_basis_store.overrides() == {}


# --- HTTP 层：这三条只给管理员 ---------------------------------------------

def _req(role: str | None, username: str = "root"):
    class Req:
        class state:
            user = None if role is None else {"role": role, "username": username}
    return Req()


@pytest.fixture
def routes(cost_basis_store, monkeypatch):
    """路由用的是 main 里的全局 store。换成夹具那个——这一组要验的是路由本身
    （管理员闸门、大小写、404），不是 runtime 的接线。"""
    from analyzer import main
    monkeypatch.setattr(main, "cost_basis_store", cost_basis_store)
    return main


def test_routes_reject_members_and_anonymous(routes):
    from fastapi import HTTPException
    from analyzer.main import CostBasisRequest, cost_basis_list, cost_basis_set

    body = CostBasisRequest(avg_cost_usd=600.0, qty_at_entry=None)
    for role in (None, "member"):
        with pytest.raises(HTTPException) as got:
            cost_basis_list(_req(role))
        assert got.value.status_code == 403
        with pytest.raises(HTTPException) as got:
            cost_basis_set("BNB", body, _req(role))
        assert got.value.status_code == 403


def test_routes_roundtrip_and_record_who(routes):
    from analyzer.main import CostBasisRequest, cost_basis_list, cost_basis_set

    cost_basis_set("bnb", CostBasisRequest(avg_cost_usd=612.5, qty_at_entry=6.712),
                   _req("admin", "alice"))
    rows = cost_basis_list(_req("admin"))
    assert len(rows) == 1
    assert rows[0]["asset"] == "BNB" and rows[0]["updated_by"] == "alice"


def test_delete_missing_entry_is_404_not_a_silent_ok(routes):
    from fastapi import HTTPException
    from analyzer.main import cost_basis_delete

    with pytest.raises(HTTPException) as got:
        cost_basis_delete("NOPE", _req("admin"))
    assert got.value.status_code == 404


def test_avg_cost_must_be_positive():
    """0 或负的均价会把未实现算成一个荒谬的数，挡在模型层而不是等它落库。"""
    from pydantic import ValidationError
    from analyzer.main import CostBasisRequest

    for bad in (0.0, -5.0):
        with pytest.raises(ValidationError):
            CostBasisRequest(avg_cost_usd=bad, qty_at_entry=None)
