"""Admin routes for Binance portfolio metadata that the upstream API omits."""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import routes as auth_routes

_SYMBOL = re.compile(r"[A-Z][A-Z0-9.-]{0,15}")


class StockCostStore(Protocol):
    def upsert_stock_cost(self, symbol: str, trade_value_usd: Decimal,
                          commission_usd: Decimal, position_qty: Decimal,
                          updated_by: int) -> dict: ...


class StockCostRequest(BaseModel):
    trade_value_usd: Decimal = Field(gt=0, allow_inf_nan=False)
    commission_usd: Decimal = Field(ge=0, allow_inf_nan=False)
    position_qty: Decimal = Field(gt=0, allow_inf_nan=False)


def _public(row: dict) -> dict:
    updated_at = row.get("updated_at")
    return {
        "symbol": str(row["symbol"]),
        "trade_value_usd": float(row["trade_value_usd"]),
        "commission_usd": float(row["commission_usd"]),
        "position_qty": float(row["position_qty"]),
        "updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else None,
    }


def build_router(store: StockCostStore) -> APIRouter:
    router = APIRouter()

    @router.put("/admin/stock-costs/{symbol}")
    def put_stock_cost(symbol: str, req: StockCostRequest,
                       admin: dict = Depends(auth_routes.require_admin)) -> dict:
        normalized = symbol.strip().upper()
        if not _SYMBOL.fullmatch(normalized):
            raise HTTPException(status_code=422, detail="股票代码格式不正确")
        row = store.upsert_stock_cost(
            normalized, req.trade_value_usd, req.commission_usd,
            req.position_qty, int(admin["id"]),
        )
        return {"stock_cost": _public(row)}

    return router
