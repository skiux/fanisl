"""Admin writes for Binance-owned portfolio metadata."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from fanisl.binance import routes


class CostStore:
    def __init__(self) -> None:
        self.saved = None

    def upsert_stock_cost(self, symbol, trade_value_usd, commission_usd,
                          position_qty, updated_by):
        self.saved = (symbol, trade_value_usd, commission_usd, position_qty, updated_by)
        return {
            "symbol": symbol,
            "trade_value_usd": trade_value_usd,
            "commission_usd": commission_usd,
            "position_qty": position_qty,
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
        "trade_value_usd": 1000,
        "commission_usd": 0.4,
        "position_qty": 40,
    })

    assert response.status_code == 200
    assert store.saved == (
        "SOXL", Decimal("1000"), Decimal("0.4"), Decimal("40"), 7)
    assert response.json() == {"stock_cost": {
        "symbol": "SOXL", "trade_value_usd": 1000.0, "commission_usd": 0.4,
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
    valid = {"trade_value_usd": 1000, "commission_usd": 0, "position_qty": 40}

    assert client.put("/admin/stock-costs/invalid symbol", json=valid).status_code == 422
    assert client.put("/admin/stock-costs/SOXL", json={
        **valid, "trade_value_usd": 0,
    }).status_code == 422
    assert client.put("/admin/stock-costs/SOXL", json={
        **valid, "commission_usd": -0.1,
    }).status_code == 422
    assert client.put("/admin/stock-costs/SOXL", json={
        **valid, "position_qty": 0,
    }).status_code == 422
    assert store.saved is None
