# Manual Stock Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unreliable stock cost reconstruction with durable admin-entered trade value and commission, then validate the recent console work as a complete user-facing product.

**Architecture:** Store one cost record per stock symbol beside the Binance source cache. The portfolio builder applies it only while the saved quantity matches the current holding; an admin-only Binance router updates it. The console exposes a compact inline editor in each stock row and refreshes the full snapshot after a save.

**Tech Stack:** FastAPI, Pydantic, psycopg 3, React 19, TypeScript, Vitest, Tailwind CSS.

---

### Task 1: Persist manual stock costs

**Files:**
- Modify: `backend/fanisl/binance/cache.py`
- Test: `backend/tests/test_binance_cache.py`

- [ ] **Step 1: Write failing persistence tests**

Add a test that calls `upsert_stock_cost("soxl", Decimal("1000"), Decimal("0.4"), Decimal("40"), "admin-id")`, reads it through `stock_costs()`, and asserts uppercase normalization, exact numeric values, updater id, and an aware `updated_at`. Call the upsert again and assert that one row is updated rather than duplicated.

- [ ] **Step 2: Run the focused test and confirm the missing method failure**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_cache.py -q`

Expected: FAIL because `SourceCache.upsert_stock_cost` and `SourceCache.stock_costs` do not exist.

- [ ] **Step 3: Add the durable table and store methods**

Create `binance_stock_costs` with `symbol` as its primary key, positive checks for trade value and position quantity, a non-negative commission check, and update metadata. Extend `SourceCache.__init__` to create both tables. Implement:

```python
def stock_costs(self) -> dict[str, dict]:
    with self.pool.connection() as conn:
        rows = conn.execute(
            "SELECT symbol, trade_value_usd, commission_usd, position_qty, "
            "updated_by, updated_at FROM binance_stock_costs"
        ).fetchall()
    return {str(row["symbol"]): dict(row) for row in rows}

def upsert_stock_cost(self, symbol: str, trade_value_usd: Decimal,
                      commission_usd: Decimal, position_qty: Decimal,
                      updated_by: str) -> dict:
    with self.pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO binance_stock_costs "
            "(symbol, trade_value_usd, commission_usd, position_qty, updated_by) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (symbol) DO UPDATE SET "
            "trade_value_usd=EXCLUDED.trade_value_usd, "
            "commission_usd=EXCLUDED.commission_usd, "
            "position_qty=EXCLUDED.position_qty, updated_by=EXCLUDED.updated_by, "
            "updated_at=now() RETURNING *",
            (symbol.upper(), trade_value_usd, commission_usd, position_qty, updated_by),
        ).fetchone()
    return dict(row)
```

- [ ] **Step 4: Run the focused tests**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_cache.py -q`

Expected: PASS.

### Task 2: Add the admin write endpoint

**Files:**
- Create: `backend/fanisl/binance/routes.py`
- Create: `backend/tests/test_binance_routes.py`
- Modify: `backend/fanisl/main.py`

- [ ] **Step 1: Write failing route tests**

Build a small FastAPI app with the Binance router and a middleware that assigns a test user to `request.state.user`. Assert that an admin can save `SOXL`, a member receives 403 before body validation, lowercase symbols normalize to uppercase, invalid symbols receive 422, and zero/negative/non-finite values are rejected.

- [ ] **Step 2: Run the focused tests and confirm the missing module failure**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_routes.py -q`

Expected: FAIL because `fanisl.binance.routes` does not exist.

- [ ] **Step 3: Implement the Binance router**

Use a Pydantic request model with decimal bounds and this endpoint shape:

```python
@router.put("/admin/stock-costs/{symbol}")
def put_stock_cost(symbol: str, req: StockCostRequest,
                   admin: dict = Depends(auth_routes.require_admin)) -> dict:
    normalized = symbol.strip().upper()
    if not SYMBOL.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="股票代码格式不正确")
    row = store.upsert_stock_cost(
        normalized, req.trade_value_usd, req.commission_usd,
        req.position_qty, str(admin["id"]),
    )
    return {"stock_cost": serialize_stock_cost(row)}
```

Add only the router import and `include_router` assembly to `backend/fanisl/main.py`.

- [ ] **Step 4: Run route and app contract tests**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_routes.py tests/test_api_doc.py -q`

Expected: PASS.

### Task 3: Replace stock history reconstruction in the portfolio

**Files:**
- Modify: `backend/fanisl/binance/portfolio.py`
- Modify: `backend/tests/test_binance_portfolio.py`
- Modify: `backend/tests/test_binance_client_contract.py`
- Modify: `backend/fanisl/binance/client.py`

- [ ] **Step 1: Replace reconstruction tests with manual-cost tests**

Delete tests for `_equity_costs`, order-detail lookups, fee completeness, and history-driven reconciliation. Add tests that assert:

```python
cache.upsert_stock_cost("SOXL", Decimal("920"), Decimal("4"), Decimal("40"), "admin")
row = next(row for row in build(cache)["stocks"]["positions"] if row["symbol"] == "SOXL")
assert row["cost_status"] == "manual"
assert row["trade_value_usd"] == 920.0
assert row["commission_usd"] == 4.0
assert row["cost_basis_usd"] == 924.0
assert row["avg_cost_usd"] == 23.1
```

Add separate missing and quantity-mismatch tests. The stale test must retain raw saved fields for editing while returning null derived cost and PnL.

- [ ] **Step 2: Run the focused portfolio tests and confirm contract failures**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_portfolio.py -q`

Expected: FAIL because the portfolio still reconstructs history.

- [ ] **Step 3: Remove automatic reconstruction and apply saved inputs**

Remove portfolio-only equity history jobs, detail jobs, history merge, `_equity_costs`, their TTL, and related constants. Load `manual_costs = cache.stock_costs()` in `build_portfolio` and pass it to `_stocks` / `_stock_positions`. For each position compute:

```python
saved = manual_costs.get(symbol)
matches = bool(saved and abs(float(saved["position_qty"]) - total_qty) <= tolerance)
status = "manual" if matches else "stale" if saved else "missing"
total_cost = float(saved["trade_value_usd"] + saved["commission_usd"]) if matches else None
average = total_cost / total_qty if total_cost is not None and total_qty > 0 else None
unrealized = mark * total_qty - total_cost if mark is not None and total_cost is not None else None
```

Return raw manual fields, `cost_position_qty`, and `cost_updated_at`; remove stock `realized_pnl_usd`. Change coverage to `{manual, stale, total}`. Update `STOCKS_COVERAGE` to state that cost is manually entered because Binance does not provide a complete source.

Remove `equity_order_detail` from the client and its portfolio-only contract test. Keep order and trade history calls used by the orders page.

- [ ] **Step 4: Run all Binance backend tests**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_cache.py tests/test_binance_routes.py tests/test_binance_portfolio.py tests/test_binance_orders.py tests/test_binance_client_contract.py -q`

Expected: PASS.

### Task 4: Update the console contract and request client

**Files:**
- Modify: `console/src/api/types.ts`
- Modify: `console/src/api/client.ts`
- Modify: `console/src/api/fixtures.ts`
- Modify: `console/src/api/client.test.ts`

- [ ] **Step 1: Add a failing save-client test**

Mock `fetch`, call `saveStockCost("SOXL", { trade_value_usd: 920, commission_usd: 4, position_qty: 40 })`, and assert a credentialed PUT to `/admin/stock-costs/SOXL` with the exact JSON body. Assert fixture snapshots expose `manual | missing | stale` and `{manual, stale, total}`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd console && npm test -- --run src/api/client.test.ts`

Expected: FAIL because `saveStockCost` does not exist.

- [ ] **Step 3: Implement the TypeScript contract and client**

Change `StockPosition` to carry:

```ts
cost_status: 'manual' | 'missing' | 'stale'
trade_value_usd: number | null
commission_usd: number | null
cost_position_qty: number | null
cost_updated_at: string | null
avg_cost_usd: number | null
cost_basis_usd: number | null
unrealized_pnl_usd: number | null
unrealized_pnl_pct: number | null
```

Change `cost_coverage` to `{ manual: number; stale: number; total: number }`, update all fallback snapshots and fixtures, and add a live-only `saveStockCost` wrapper over `apiJson`.

- [ ] **Step 4: Run API and type checks**

Run: `cd console && npm test -- --run src/api/client.test.ts && npm run typecheck`

Expected: PASS.

### Task 5: Add the inline admin editor

**Files:**
- Create: `console/src/features/portfolio/StockCostEditor.tsx`
- Create: `console/src/features/portfolio/stock-cost-editor.test.tsx`
- Modify: `console/src/features/portfolio/StockPositions.tsx`
- Modify: `console/src/features/portfolio/views.tsx`
- Modify: `console/src/features/portfolio/StatementPage.tsx`
- Modify: `console/src/features/portfolio/stocks.test.ts`

- [ ] **Step 1: Write failing editor behavior tests**

Render the editor as admin and assert two number fields, current quantity context, live total and per-share preview, validation, disabled saving state, inline failure text, and preserved values after failure. Render the holdings view as a member and assert that no cost action appears. Assert saving calls the request and then refreshes the portfolio.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `cd console && npm test -- --run src/features/portfolio/stock-cost-editor.test.tsx src/features/portfolio/stocks.test.ts`

Expected: FAIL because the editor and new status copy do not exist.

- [ ] **Step 3: Implement the editor and refresh flow**

Use `useIsAdmin()` for presentation only. Show “待录入成本” / “管理员尚未录入” for missing data and a quantity-change explanation for stale data. Admin actions open an inline form; the current quantity is read-only and submitted automatically. Keep inputs on error, close on success, and call the parent refresh callback after saving. Update the summary to report manual coverage and stale entries without the removed fee-estimation wording.

- [ ] **Step 4: Run portfolio UI tests**

Run: `cd console && npm test -- --run src/features/portfolio/stock-cost-editor.test.tsx src/features/portfolio/stocks.test.ts`

Expected: PASS.

### Task 6: Update ownership documentation and remove stale descriptions

**Files:**
- Modify: `docs/plans/active/base.md`
- Modify: `backend/fanisl/binance/README.md` if the removed reconstruction is described there

- [ ] **Step 1: Search for the removed contract**

Run: `rg -n "reconciled|estimated|incomplete|股票.*成本|equity/order/detail|stock_history" backend/fanisl/binance console/src docs -g '*.md' -g '*.py' -g '*.ts' -g '*.tsx'`

- [ ] **Step 2: Update owned documentation and record the base contract request**

Remove stale Binance-owned statements about reconstructed cost. In `docs/plans/active/base.md`, request documentation of `PUT /admin/stock-costs/{symbol}`, the manual/missing/stale statuses, the raw manual inputs, and the `{manual, stale, total}` coverage object in `backend/api.md`.

- [ ] **Step 3: Re-run the search**

Expected: removed production terms remain only where they describe unrelated realized PnL or historical records.

### Task 7: Deep product audit and corrective pass

**Files:**
- Modify: only console/Binance files where a reproduced material issue requires correction
- Create: `docs/superpowers/reviews/2026-09-21-console-product-audit.md`

- [ ] **Step 1: Review code changes from the requested baseline**

Run: `git diff --stat f6f5e07..HEAD -- console backend/fanisl/binance backend/fanisl/trading` and inspect each changed file for duplicated state, invalid financial math, inaccessible controls, and stale product copy.

- [ ] **Step 2: Review rendered pages at real breakpoints**

Run the API/auth stub and console dev server. Inspect overview, holdings, futures, and risk views at desktop, tablet, and 390 px mobile widths in light and dark themes. Exercise chart selection and outside-click clearing, all-symbol scrolling, section switching, stock sorting/editing/error recovery, risk controls, keyboard focus, and reduced motion. Check the browser console after every view.

- [ ] **Step 3: Fix each reproduced material issue with a focused regression test**

For each correction, add the smallest behavior or model test that fails before the change, apply the proportional fix, and run the focused test. Do not replace working visual structures without evidence.

- [ ] **Step 4: Record evidence and remaining limits**

Write the routes, breakpoints, themes, interactions, screenshots, browser-console state, fixed findings, and any verified external-data limitation in the audit document.

### Task 8: Full verification and commit

**Files:**
- All changed files from Tasks 1–7

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests -q`

Expected: all tests pass.

- [ ] **Step 2: Run the full console suite**

Run: `cd console && npm run test && npm run typecheck && npm run lint && npm run build`

Expected: all checks pass.

- [ ] **Step 3: Inspect the final diff and working tree**

Run: `git diff --check && git diff --stat && git status --short`

Expected: no whitespace errors; only intended files are changed.

- [ ] **Step 4: Commit the verified implementation**

Stage only the requested console/Binance files, the minimal `main.py` router assembly, the base documentation request, and the design/plan/audit documents. Commit on `main` with a message describing manual stock cost entry and the verified console corrections.
