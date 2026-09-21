# Console product audit — 2026-09-21

Scope: the asset console work from `d84f7cc` through the manual stock-cost workflow and its
final frontend integration. This review covers the user-facing result, interaction,
responsive behavior, data meaning, and implementation boundaries.

## Result against the requested behavior

| Area | Verified result |
|---|---|
| Stock cost | Binance remains the source of the current quantity. An admin enters cumulative trade value and commission for that quantity; total cost is their sum. There is no history replay or old value to override. |
| Cost validity | A saved quantity equal to the wallet quantity is `manual`. Missing input is `missing`. A later quantity change makes the record `stale` and suppresses average cost and PnL until a new entry is saved. |
| Permissions | The editor is shown only to admins. The endpoint also rejects members before request-body validation. It writes the local `binance_stock_costs` table and never sends a Binance trading request. |
| Stocks layout | Stock positions follow the futures-page hierarchy: symbol and logo, quantity and custody, value/PnL at row level, then cost/quote/value details. SOXL is the realistic fixture position. |
| Wallet grouping | Non-stable assets in spot, futures, and cross-margin wallets are merged into the existing spot-holdings list with location labels. The separate “合约中的现货持仓” module is gone. Stable assets remain in cash. |
| Asset marks | AMZN uses the Amazon Smile ICO; XAUT uses the local Tether Gold SVG; SOXL and common ETFs use local assets. No runtime image host learns the account holdings. |
| Allocation wheel | All 12 long assets remain separate sectors; there is no “其他”. BTC, NVDA, and XAU total about 50.7%. Each label contains local mark, code, value, and share, with size proportional to sector share. The default center shows only the amount; selection shows the logo, amount, and share. |
| Allocation interaction | Selection uses one subtle inner cursor. Sector color, opacity, and geometry do not flash or change. Repeat click, Escape, “查看全部”, and a click outside the chart/list clear selection. “全部标的” is its own bounded scroll region. |
| Pressure sizing | The top cards show current notional and the 1×, 1.5×, and 2× account-equity targets, including target minus current notional. |
| Opening capacity | The 1×, 2×, 3×, and 5× cards use `scenario equity × target total leverage − scenario futures notional`; the removed 10× option has not returned. Available balance is kept as a separate margin-liquidity reading. |
| Margin risk | Current margin ratio is maintenance margin divided by margin balance. Shocked maintenance is recalculated per leverage bracket when possible. “临界跌幅” is the synchronized fall at which the account ratio reaches 100%; a higher percentage means more buffer. |
| TradFi status | Futures positions show the useful market-session label only. Internal text such as `TradFi · NO_TRADING` is not rendered. |
| BFUSD | The published rate remains sourced from the newest BFUSD rate-history row and appears through the cash/yield path when available. |

## Calculation audit

Manual stock cost uses these identities:

```text
total cost       = cumulative trade value + commission
average cost     = total cost / current quantity
unrealized PnL   = mark price × current quantity − total cost
unrealized PnL % = unrealized PnL / total cost
```

The backend performs the arithmetic with `Decimal`; the API converts the final values for the JSON
contract. The stored quantity is checked against the current wallet quantity with the exchange step
size as tolerance. A mismatch does not reuse or rescale the old input.

Risk sizing uses account equity as the leverage denominator:

```text
target notional        = current account equity × target leverage
remaining before shock = max(0, target notional − current futures notional)
remaining after shock  = max(0, shocked equity × target leverage − shocked futures notional)
margin ratio           = maintenance margin / margin balance
```

Changing the target position rebuilds positions at current mark prices before applying the selected
drop. This avoids multiplying historical unrealized PnL. Cross-margin liquidation is determined by
the account ratio; exchange liquidation prices are used only for isolated positions.

## Rendered-page review

- Reviewed overview, holdings, futures, and risk at the normal in-app width in both themes.
- Reviewed all four views in a 390 × 844 harness. At that width the overview, holdings, and futures
  pages had equal client and scroll widths. The risk chart originally produced a 4px page overflow;
  the mobile expansion was reduced from 48px to 40px. The main scroll container then measured
  `349 / 349` while the wheel retained a 349px diameter.
- Scanned nine fixture states (`ok`, `stale`, `fapi_blocked`, `all_blocked`, `no_history`,
  `unauthorized`, `empty`, `loading`, and `down`) across the four asset views. None rendered
  `NaN`/`undefined`, introduced page-level horizontal overflow, or logged a browser warning/error.
- Used the admin editor in the browser. Changing `960 + 1.6` produced `$961.60` total and `$24.04`
  average for 40 shares. Saving `1000 + 2` refreshed the row to `$1,002.00`, `$25.05`, and the
  corresponding PnL. If the write succeeds but the following snapshot refresh fails, the inline error
  now says the cost was saved and retains both entered values. Inputs use decimal text fields because
  number-input wheel scrolling had changed an entered value without an explicit edit.
- Inspected the risk selection state in both themes: text contrast remains readable, the center mark
  and values stay legible, and selection does not recolor or move sectors.

## Remaining external boundary

`backend/api.md` is owned by the base seat. The exact portfolio fields and
`PUT /admin/stock-costs/{symbol}` documentation request is recorded in
`docs/plans/active/base.md`. Live Binance credentials were not used for visual QA; upstream behavior
is covered by the backend contract fixtures and the current Binance documentation notes in
`backend/fanisl/binance/README.md`.
