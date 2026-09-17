# Binance 2026 API Migration Implementation Plan

> **For Codex:** Execute this plan in order. Add a failing regression test before each behavior change, run the focused test, then run the full seat verification before committing each phase.

**Goal:** Bring the trading console's read-only Binance integration up to the current 2026 REST contracts, including standalone Stocks Trading and TradFi perpetual metadata, without inventing stock holdings that Binance does not expose.

**Architecture:** Keep the existing source-isolated cache and `/portfolio`, `/orders`, `/ledger` response shapes. Extend the client with current read-only endpoints, normalize new records at the assembler boundary, and expose source coverage explicitly. Standalone equities use venue `equity`; USD-M TradFi perpetuals remain venue `usdm` and gain product metadata.

**Tech Stack:** Python 3, FastAPI, httpx, pytest, React, TypeScript, Vitest.

---

### Phase 1: Current endpoint and accounting correctness — complete (`dd86e5d`)

- Add regression tests for `/fapi/v3/account`, `/fapi/v3/positionRisk`, `needBalanceDetail=true`, `/fapi/v1/openAlgoOrders`, optional-symbol futures `allOrders`, and `SPECIAL_FUNDING_FEE`.
- Migrate the client and assemblers while preserving per-source degradation.
- Update module and TypeScript contract comments, including HMAC's supported status.
- Run focused Binance tests, then the backend suite and console test/typecheck checks.
- Commit the phase on `main`.

### Phase 2: Standalone Stocks Trading and TradFi perpetual metadata — complete (`ef80a3b`)

- Add client tests for equity exchange information, tokenized-asset mapping, quotes, open orders, order history, and trade history.
- Normalize standalone equity orders and fills into the existing orders page with venue `equity`, UUID order identifiers, stock sessions, and USDC values.
- Add equity source states. Do not infer equity holdings from fills: Binance currently exposes agreement status and trade records, but no standalone equity position endpoint.
- Read futures `exchangeInfo` and `tradingSchedule`; classify TradFi perpetuals from official metadata rather than ticker names.
- Read `symbolAdlRisk` separately from account ADL quantiles and expose its qualitative 30-minute risk signal.
- Add tokenized-stock asset mapping for wallet details where the exchange returns assets such as `AAPLB`.
- Run backend and console verification and inspect the page at desktop and mobile widths.
- Commit the phase on `main`.

### Phase 3: Account capability and risk coverage — complete (this commit)

- Add account capability detection from `/sapi/v1/account/info` and API restrictions.
- Query isolated-margin and liquidation-loan read endpoints only when the account capability says they apply; keep unsupported products as explicit source states.
- Gate portfolio-margin adapters on the detected account mode. Do not call the agreement-signing or any other mutating endpoint.
- Document the retained REST polling model. Defer Stocks WebSocket ingestion unless a persistent event store is added, because the current console cache cannot guarantee recovery of missed order events.
- Run full verification, inspect source-state behavior, and commit the phase.
