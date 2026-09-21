# Stock Holdings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Historical implementation record. The automatic cost-replay design below was retired on
> 2026-09-21 because Binance did not provide enough fee data to make it reliable. Current behavior
> uses admin-entered trade value plus commission; see `console/README.md` and
> `backend/fanisl/binance/README.md`.

**Goal:** Show direct and tokenized stock holdings with the same information hierarchy as futures positions, an official XAUT mark, reconciled cost basis, current quotes, and clear coverage states.

**Architecture:** Wallet `EQ_*` and tokenized balances remain the authority for current quantities. Full order history supplies total fees and full trade history supplies the real per-fill sequence; fees are allocated by fill notional before replaying moving-average cost. Derived numbers are exposed only when both histories are fresh and reconstructed net shares reconcile with the combined direct and validly converted tokenized quantity. The frontend derives a unified stock-position view model and renders it in the existing 8+4 portfolio grid.

**Tech Stack:** Python 3/FastAPI data assembly, React 19, TypeScript 6, Tailwind CSS 4, Vitest, pytest.

---

### Task 1: Official XAUT icon

**Files:**
- Create: `console/public/icons/XAUT.svg`
- Modify: `console/scripts/fetch-icons.mjs`
- Modify: `console/src/components/icons.ts`

- [x] Add the official Tether XAUt SVG URL to the deterministic icon source list.
- [x] Copy the unmodified official SVG into `console/public/icons/XAUT.svg`.
- [x] Add `XAUT: 'XAUT.svg'` to the runtime icon map.
- [x] Verify the SVG parses and the icon map resolves XAUT.

### Task 2: Fail closed when stock history is truncated

**Files:**
- Modify: `backend/tests/test_binance_client_contract.py`
- Modify: `backend/fanisl/binance/client.py`

- [x] Write a failing test whose response reports more rows than `max_pages * size`.
- [x] Run `PYTHONPATH=. python -m pytest tests/test_binance_client_contract.py -q` and confirm the new test fails because the client silently returns a partial history.
- [x] Raise a source-level `BinanceError` when the page guard is exhausted before `total` rows are collected.
- [x] Re-run the focused test and confirm it passes.

### Task 3: Reconciled stock cost and market metadata

**Files:**
- Modify: `backend/tests/test_binance_portfolio.py`
- Modify: `backend/tests/binance_mock.py`
- Modify: `backend/fanisl/binance/portfolio.py`

- [x] Add failing tests for wallet balance breakdown, weighted-average cost, sell cost reduction, quantity mismatch, quote spread, and exchange metadata.
- [x] Run the focused portfolio tests and confirm failures are due to missing stock fields.
- [x] Fetch complete stock order and per-fill trade history at the stock cache cadence, and fetch one current quote per held symbol.
- [x] Replay per-fill executions in `executionAt` order. Allocate each order's total fee across its fills by notional only when no sell falls between a multi-fill buy; ambiguous same-millisecond opposite fills and fee timing fail closed.
- [x] Compare replayed net shares with `direct qty + tokenized underlying qty` using the exchange step size. Set `cost_status='reconciled'` only within numeric tolerance; otherwise expose null cost/PnL fields and `cost_status='incomplete'`.
- [x] Ignore stale failed history and quote payloads when deriving current values; require both bid and ask for a midpoint and never substitute wallet valuation or a single side for a missing market quote.
- [x] Respect `multiplierValid`; keep unresolved token balances visible without expressing them as stock shares.
- [x] Preserve `free`, `locked`, `freeze`, and `withdrawing` quantities from wallet detail.
- [x] Attach bid, ask, midpoint, spread, tradability, fractional, extended-session, and overnight fields without replacing wallet valuation.
- [x] Re-run the focused portfolio tests and confirm they pass.

### Task 4: Futures-style stock positions layout

**Files:**
- Create: `console/src/features/portfolio/StockPositions.tsx`
- Create: `console/src/features/portfolio/stock-position-model.ts`
- Modify: `console/src/features/portfolio/stocks.test.ts`
- Modify: `console/src/features/portfolio/views.tsx`
- Modify: `console/src/api/types.ts`
- Modify: `console/src/api/fixtures.ts`

- [x] Add failing component tests for direct-stock fixtures, position badges, available/locked quantities, three price metrics, reconciled PnL, incomplete-cost messaging, sort controls, and the 8+4 grid summary.
- [x] Run `npm run test -- src/features/portfolio/stocks.test.ts` and confirm the new assertions fail for the flat table.
- [x] Define a pure view-model adapter combining direct and tokenized rows while preserving custody form.
- [x] Render sortable position rows with logo, symbol, custody badge, market state, quantity/value, cost/quote/value metrics, and reconciled PnL.
- [x] Render right-side summaries for direct/tokenized market value and cost coverage; never fabricate totals from incomplete rows.
- [x] Add realistic direct holdings to the `scenario=ok` fixture so browser verification exercises the layout.
- [x] Re-run the focused test and confirm it passes.

### Task 5: Verification and commit

**Files:**
- Verify all modified files.

- [x] Run `cd backend && PYTHONPATH=. python -m pytest tests/test_trading_*.py tests/test_binance_*.py -q`.
- [x] Run `cd console && npm run test && npm run typecheck && npm run lint`.
- [x] Inspect the holdings page at desktop and mobile widths in both light and dark themes, including the complete and incomplete coverage states.
- [x] Review `git diff --check`, stage only console/Binance files, and commit on `main` after all checks pass.
