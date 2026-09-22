"""Admin routes for Binance portfolio metadata that the upstream API omits."""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import routes as auth_routes
from .common import STABLE_ASSETS

_SYMBOL = re.compile(r"[A-Z][A-Z0-9.-]{0,15}")


class CostStore(Protocol):
    def upsert_stock_cost(self, symbol: str, cost_price_usd: Decimal,
                          commission_usd: Decimal, position_qty: Decimal,
                          updated_by: int) -> dict: ...
    def upsert_spot_cost(self, asset: str, cost_price_usd: Decimal,
                         commission_usd: Decimal, position_qty: Decimal,
                         updated_by: int) -> dict: ...


class StockCostRequest(BaseModel):
    cost_price_usd: Decimal = Field(gt=0, allow_inf_nan=False)
    commission_usd: Decimal = Field(ge=0, allow_inf_nan=False)
    position_qty: Decimal = Field(gt=0, allow_inf_nan=False)


def _public(row: dict, *, key: str = "symbol") -> dict:
    updated_at = row.get("updated_at")
    return {
        key: str(row[key]),
        "cost_price_usd": float(row["cost_price_usd"]),
        "commission_usd": float(row["commission_usd"]),
        "position_qty": float(row["position_qty"]),
        "updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else None,
    }


def build_router(store: CostStore) -> APIRouter:
    router = APIRouter()

    @router.put("/admin/stock-costs/{symbol}")
    def put_stock_cost(symbol: str, req: StockCostRequest,
                       admin: dict = Depends(auth_routes.require_admin)) -> dict:
        normalized = symbol.strip().upper()
        if not _SYMBOL.fullmatch(normalized):
            raise HTTPException(status_code=422, detail="股票代码格式不正确")
        row = store.upsert_stock_cost(
            normalized, req.cost_price_usd, req.commission_usd,
            req.position_qty, int(admin["id"]),
        )
        return {"stock_cost": _public(row)}

    @router.put("/admin/spot-costs/{asset}")
    def put_spot_cost(asset: str, req: StockCostRequest,
                      admin: dict = Depends(auth_routes.require_admin)) -> dict:
        normalized = asset.strip().upper()
        if not _SYMBOL.fullmatch(normalized) or normalized in STABLE_ASSETS:
            raise HTTPException(status_code=422, detail="现货资产代码格式不正确或属于现金")
        row = store.upsert_spot_cost(
            normalized, req.cost_price_usd, req.commission_usd,
            req.position_qty, int(admin["id"]),
        )
        return {"spot_cost": _public(row, key="asset")}

    return router
