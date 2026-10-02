"""Routes for data the Binance API does not have: admin-entered costs and the fund rules.

The fund endpoints (`binance/fund.py`) sit under the existing `/portfolio` and
`/admin` prefixes, so nginx needs no new location.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Protocol

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import routes as auth_routes
from .common import STABLE_ASSETS
from .fund import FundStore

_SYMBOL = re.compile(r"[A-Z][A-Z0-9.-]{0,15}")


class CostStore(Protocol):
    def upsert_stock_cost(self, symbol: str, cost_price_usd: Decimal,
                          commission_usd: Decimal, position_qty: Decimal,
                          updated_by: int) -> dict: ...
    def upsert_spot_cost(self, asset: str, cost_price_usd: Decimal,
                         commission_usd: Decimal, position_qty: Decimal,
                         updated_by: int) -> dict: ...


class FundSource(Protocol):
    def settings(self) -> dict | None: ...
    def save_settings(self, *, initial_nav_usd: Decimal | None, inception_date: date | None,
                      cash_usd: Decimal | None, updated_by: int) -> dict: ...
    def members(self, user_id: int | None = None) -> list[dict]: ...
    def management_fee_total(self) -> Decimal: ...
    def user_role(self, user_id: int) -> str | None: ...
    def save_member(self, user_id: int, **fields) -> dict | None: ...


class StockCostRequest(BaseModel):
    cost_price_usd: Decimal = Field(gt=0, allow_inf_nan=False)
    commission_usd: Decimal = Field(ge=0, allow_inf_nan=False)
    position_qty: Decimal = Field(gt=0, allow_inf_nan=False)


def _ratio():
    return Field(ge=0, le=1, allow_inf_nan=False)


class FundSettingsRequest(BaseModel):
    initial_nav_usd: Decimal | None = Field(default=None, gt=0, allow_inf_nan=False)
    inception_date: date | None = None
    cash_usd: Decimal | None = Field(default=None, ge=0, allow_inf_nan=False)


class FundMemberRequest(BaseModel):
    is_manager: bool
    is_investor: bool
    invested_capital_usd: Decimal = Field(ge=0, allow_inf_nan=False)
    loss_allocation: Decimal = _ratio()
    management_fee: Decimal = _ratio()
    performance_fee: Decimal = _ratio()
    investor_return: Decimal = _ratio()


def _number(value) -> float | None:
    return None if value is None else float(value)


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, (date, datetime)) else None


def _fund_settings(row: dict | None) -> dict:
    row = row or {}
    return {
        "initial_nav_usd": _number(row.get("initial_nav_usd")),
        "inception_date": _iso(row.get("inception_date")),
        "cash_usd": _number(row.get("cash_usd")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _fund_member(row: dict) -> dict:
    return {
        "user_id": int(row["user_id"]),
        "username": str(row["username"]),
        "display_name": str(row["display_name"] or row["username"]),
        "is_manager": bool(row["is_manager"]),
        "is_investor": bool(row["is_investor"]),
        **{key: float(row[key]) for key in (
            "invested_capital_usd", "loss_allocation", "management_fee",
            "performance_fee", "investor_return")},
        "updated_at": _iso(row.get("updated_at")),
    }


def _public(row: dict, *, key: str = "symbol") -> dict:
    updated_at = row.get("updated_at")
    return {
        key: str(row[key]),
        "cost_price_usd": float(row["cost_price_usd"]),
        "commission_usd": float(row["commission_usd"]),
        "position_qty": float(row["position_qty"]),
        "updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else None,
    }


def build_router(store: CostStore, fund: FundSource | None = None) -> APIRouter:
    router = APIRouter()
    # 与成本表同库：fund_members 外键指向 users，那张表也在主库
    fund_store: FundSource = fund if fund is not None else FundStore(store.pool)

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

    @router.get("/portfolio/fund")
    def get_fund(request: Request) -> dict:
        """账户规则。管理员拿到全部成员；成员只拿到自己那一行（不是参与者就是空列表）。

        **必须在服务端筛**：别人的出资和比例不该出现在成员的响应里。管理费合计照给——
        成员算自己的账户也要先扣掉它。
        """
        user = auth_routes.current_user(request)
        admin = user["role"] == "admin"
        rows = fund_store.members() if admin else fund_store.members(int(user["id"]))
        return {
            "settings": _fund_settings(fund_store.settings()),
            "management_fee_total": float(fund_store.management_fee_total()),
            "members": [_fund_member(row) for row in rows],
        }

    @router.put("/admin/fund")
    def put_fund(req: FundSettingsRequest,
                 admin: dict = Depends(auth_routes.require_admin)) -> dict:
        row = fund_store.save_settings(
            initial_nav_usd=req.initial_nav_usd, inception_date=req.inception_date,
            cash_usd=req.cash_usd, updated_by=int(admin["id"]))
        return {"settings": _fund_settings(row)}

    @router.put("/admin/fund/members/{user_id}")
    def put_fund_member(user_id: int, req: FundMemberRequest,
                        admin: dict = Depends(auth_routes.require_admin)) -> dict:
        role = fund_store.user_role(user_id)
        if role is None:
            raise HTTPException(status_code=404, detail="用户不存在")
        if role == "admin":
            raise HTTPException(status_code=409, detail="管理员不参与分配")
        # 不属于这个角色的比例存成 0：取消 Manager 之后，旧的业绩报酬不该还在分钱
        row = fund_store.save_member(
            user_id,
            is_manager=req.is_manager, is_investor=req.is_investor,
            invested_capital_usd=req.invested_capital_usd,
            loss_allocation=req.loss_allocation,
            management_fee=req.management_fee if req.is_manager else Decimal(0),
            performance_fee=req.performance_fee if req.is_manager else Decimal(0),
            investor_return=req.investor_return if req.is_investor else Decimal(0),
            updated_by=int(admin["id"]))
        return {"member": None if row is None else _fund_member(row)}

    return router
