# Manual stock cost input

## Goal

Stop deriving stock cost from incomplete Binance order and fill history. Let an
administrator provide the missing values once, keep those values in the shared
trading database, and use them consistently for every console user.

The form records the current position's cumulative trade value and commission.
It does not record individual trades and does not calculate realized stock PnL.

## Data model

Create `binance_stock_costs` beside the existing Binance cache tables:

- `symbol` — uppercase stock ticker, primary key.
- `trade_value_usd` — cumulative value paid for the current position, excluding commission.
- `commission_usd` — cumulative commission paid for the current position.
- `position_qty` — wallet position quantity when the administrator saved the values.
- `updated_by` — administrator user id.
- `updated_at` — database update time.

The original input values remain available in the portfolio response. Derived
values are:

- total cost = trade value + commission;
- average cost = total cost / current quantity;
- unrealized PnL = midpoint quote × current quantity − total cost.

The manual cost is applied only while `position_qty` matches the current wallet
quantity within the instrument step-size tolerance. A quantity change marks the
entry stale and suppresses average cost and PnL until an administrator saves the
new current-position values. This prevents a sold or rebuilt position from
silently inheriting an obsolete cost.

## Backend

Remove portfolio cost reconstruction from equity order history, trade history,
and order details. These endpoints remain in the orders product for viewing
order and fill history.

Add an admin-only endpoint:

`PUT /admin/stock-costs/{symbol}`

Request body:

```json
{
  "trade_value_usd": 1000.00,
  "commission_usd": 0.40,
  "position_qty": 40
}
```

All values must be finite. Trade value and position quantity must be positive;
commission may be zero. Symbols are normalized to uppercase and restricted to
the stock ticker format used by Binance Stocks.

The endpoint is implemented in a Binance-owned router. `main.py` contains only
the router assembly required to connect it to the shared FastAPI application.
Backend authorization is authoritative; hiding the form in the console is only
a presentation decision.

`stocks.positions[].cost_status` becomes:

- `manual` — saved quantity still matches and cost is usable;
- `missing` — no saved input;
- `stale` — saved quantity differs from the current holding.

`realized_pnl_usd` is removed from stock positions. `cost_coverage` becomes
`{ manual, stale, total }`.

## Console

The stock row remains readable before editing. A missing cost shows “待录入成本”
for administrators and “管理员尚未录入” for members. A stale cost says that the
position quantity changed and needs new input.

Administrators get a compact “录入成本” or “修正成本” action on the relevant
stock row. It opens an inline form with two visible fields:

- 交易价值（USD）
- 手续费（USD）

The current wallet quantity is shown as context and submitted automatically.
The form previews total cost and average cost before saving. Saving refreshes the
portfolio snapshot so the row, stock summary, and portfolio totals update from
one response. Errors remain beside the form and do not discard entered values.

Members never see the editing action or the raw administration controls.

## Removal and compatibility

Delete the portfolio-only order-detail lookups, automatic stock cost replay,
fee estimation status, and their tests and documentation. Keep the equity order
and trade history client methods used by the orders page.

Fixture scenarios use manual cost data so visual review exercises the same
contract as production.

## Verification and product review

Automated checks cover persistence, validation, authorization, quantity-change
staleness, cost arithmetic, API contract, admin/member rendering, save errors,
and snapshot refresh.

After implementation, review the console changes from `f6f5e07` through the
current commit as one product:

- overview allocation chart and selection behavior;
- risk controls, stress calculations, and opening-capacity language;
- holdings, stocks, cash, futures, and source-state presentation;
- Binance 2026 product metadata and failure states;
- desktop, tablet, and 390 px mobile layouts in light and dark themes;
- internal scrolling, text contrast, overflow, focus behavior, and browser errors.

The review must fix material problems it finds. It is not complete when it only
reports them or when tests pass without inspecting the rendered pages.
