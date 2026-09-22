"""Admin writes for Binance-owned portfolio metadata."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from fanisl.binance import routes


class CostStore:
    def __init__(self) -> None:
        self.saved = None

    def upsert_stock_cost(self, symbol, cost_price_usd, commission_usd,
                          position_qty, updated_by):
        self.saved = (symbol, cost_price_usd, commission_usd, position_qty, updated_by)
        return {
            "symbol": symbol,
            "cost_price_usd": cost_price_usd,
            "commission_usd": commission_usd,
            "position_qty": position_qty,
            "updated_by": updated_by,
            "updated_at": datetime(2026, 9, 21, 8, 0, tzinfo=timezone.utc),
        }

    def upsert_spot_cost(self, asset, cost_price_usd, commission_usd,
                         position_qty, updated_by):
        self.saved = (asset, cost_price_usd, commission_usd, position_qty, updated_by)
        return {
            "asset": asset, "cost_price_usd": cost_price_usd,
            "commission_usd": commission_usd, "position_qty": position_qty,
            "updated_by": updated_by,
            "updated_at": datetime(2026, 9, 21, 8, 0, tzinfo=timezone.utc),
        }


def client_for(role: str) -> tuple[TestClient, CostStore]:
    store = CostStore()
    app = FastAPI()

    @app.middleware("http")
    async def user(request: Request, call_next):
        request.state.user = {"id": 7, "username": "tester", "role": role}
        return await call_next(request)

    app.include_router(routes.build_router(store))
    return TestClient(app), store


def test_admin_saves_normalized_stock_cost():
    client, store = client_for("admin")
    response = client.put("/admin/stock-costs/soxl", json={
        "cost_price_usd": 1000,
        "commission_usd": 0.4,
        "position_qty": 40,
    })

    assert response.status_code == 200
    assert store.saved == (
        "SOXL", Decimal("1000"), Decimal("0.4"), Decimal("40"), 7)
    assert response.json() == {"stock_cost": {
        "symbol": "SOXL", "cost_price_usd": 1000.0, "commission_usd": 0.4,
        "position_qty": 40.0, "updated_at": "2026-09-21T08:00:00+00:00",
    }}


def test_member_is_rejected_before_body_validation():
    client, store = client_for("member")
    response = client.put("/admin/stock-costs/SOXL", json={})

    assert response.status_code == 403
    assert response.json()["detail"] == "需要管理员权限"
    assert store.saved is None


def test_invalid_symbol_and_values_are_rejected():
    client, store = client_for("admin")
    valid = {"cost_price_usd": 1000, "commission_usd": 0, "position_qty": 40}

    assert client.put("/admin/stock-costs/invalid symbol", json=valid).status_code == 422
    assert client.put("/admin/stock-costs/SOXL", json={
        **valid, "cost_price_usd": 0,
    }).status_code == 422
    assert client.put("/admin/stock-costs/SOXL", json={
        **valid, "commission_usd": -0.1,
    }).status_code == 422
    assert client.put("/admin/stock-costs/SOXL", json={
        **valid, "position_qty": 0,
    }).status_code == 422
    assert store.saved is None


def test_admin_saves_spot_cost_for_current_quantity():
    client, store = client_for("admin")
    response = client.put("/admin/spot-costs/btc", json={
        "cost_price_usd": 2000, "commission_usd": 2, "position_qty": 0.1,
    })
    assert response.status_code == 200
    assert store.saved == (
        "BTC", Decimal("2000"), Decimal("2"), Decimal("0.1"), 7)
    assert response.json()["spot_cost"] == {
        "asset": "BTC", "cost_price_usd": 2000.0,
        "commission_usd": 2.0, "position_qty": 0.1,
        "updated_at": "2026-09-21T08:00:00+00:00",
    }


def test_only_admin_can_save_valid_spot_cost():
    valid = {"cost_price_usd": 2000, "commission_usd": 0, "position_qty": 0.1}
    member, member_store = client_for("member")
    assert member.put("/admin/spot-costs/BTC", json={}).status_code == 403
    assert member_store.saved is None
    admin, admin_store = client_for("admin")
    for path, body in [
        ("invalid symbol", valid), ("USDT", valid),
        ("BTC", {**valid, "cost_price_usd": 0}),
        ("BTC", {**valid, "commission_usd": -1}),
        ("BTC", {**valid, "position_qty": 0}),
    ]:
        assert admin.put(f"/admin/spot-costs/{path}", json=body).status_code == 422
    assert admin_store.saved is None
