# frontend — Agent Guide

**This is not "the frontend" — it is the knowledge engine's site** (served at
`fanisl.skiuo.com/`). The trading console is a separate application in
`console/`. Shared code is limited to `shared/login/`.

**This is its own seat.** You own `frontend/**` and nothing else. The knowledge
seat owns the corpus and `backend/fanisl/knowledge/`; the base seat owns
`backend/api.md` and `backend/fanisl/main.py`. You consume the API. If you need
an API change, write the request into `docs/plans/active/base.md` — do not edit
anything under `backend/`.

## Features

`archive` (research archive) · `asset` (asset workbench) · `discovery` ·
`knowledge` (L0/L1 browsing, unit dossier, unit reviews) · `verification`
(verdict timeline with a card "lens" below it; the page never scrolls; a record opens in a dialog)

## Sources of truth

- API contract: `../backend/api.md` — read it, do not guess field shapes
- Domain concepts and the Chinese labels for enums: `../docs/DOMAIN.md`.
  In this app the labels live only in `src/shared/domain/labels.ts`;
  `labels.test.ts` checks them line by line against `DOMAIN.md` §4 and
  `api.md` §5.6. Do not define label maps inside components
- Product definition, information architecture, and the explicit
  "never build it like this" list: `../docs/PRODUCT.md`
- `../shared/` is included by both apps' tsconfigs — editing it also changes
  `console/`, so say so in your report

## Visual system

Every colour, font and frame measure comes from the `:root` block in
`src/index.css`; the five app pages (asset, knowledge, verification,
discovery, archive) share its page shell and controls. Before 2026-09-23 each
page carried its own palette, head, width and background — 904 distinct
colour literals, seven title sizes (30–72px), six content widths — and it
showed. Keep it from drifting back:

- Colours: `--ink` `--ink-soft` `--muted` `--faint` for text, `--line`
  `--line-soft` for rules, `--hit` / `--miss` / `--partial` / `--wait` /
  `--void` (each with `-line` and `-tint`) for outcomes, `--kind-claim` /
  `--kind-method` / `--kind-concept` for unit kinds, `--chart-line` for price
  lines. Do not add page-local palettes or hard-coded greys.
- Fonts: `var(--font-sans)`, `var(--font-serif)` (verbatim quotes and long
  reading), `var(--font-mono)`. Never write `ui-monospace, monospace` on its
  own: Chrome ignores `ui-monospace` and falls back to Courier.
- Frame: the page root gets `app-page` (background and horizontal clipping;
  no texture images on app pages — only the home page keeps its artwork);
  the main column is `width: var(--site-width)` with `padding-top:
  var(--page-top)`, so every page lines up with the nav bar. The home page's
  full-width scenes use `var(--site-gutter)` as their left padding for the
  same reason; their right padding stays wider to clear the chapter rail.
- Head: `.page-head` with an `h1`, optional `.page-tabs` (view switch),
  optional `.page-head-actions` holding `.page-stats`, `.page-count`,
  `.field-search`, `.field-select` or `.btn`.
- Minimal: no English labels anywhere in the UI (`UNIT / FILTER`,
  `01 / TENSION`, `L1 / EVIDENCE`, `READ ONLY`…), no eyebrow labels, slogans,
  descriptive sub-lines under section titles, doctrine blocks or slogan
  footers, and no wide letter-spacing on Chinese text. Empty and error states
  are one sentence plus a button. The user asked for all of this on
  2026-09-23; label text is Chinese and says what the thing is, not why.
- Filters above a list use `.chips`.

## Loading lists

Paged endpoints are read in full with `fetchAllPages` (`src/shared/api/pages.ts`):
first page, then the rest in parallel. Do not fire every page up front from a
remembered total — replayed under production conditions (≈0.35s round trip,
≈300KB/s) it made the verification page slower (6.4s → 7.4s): the link is
bandwidth-bound, and extra parallel requests only compete for it. For the same
reason the knowledge page fetches its 500+ nodes after the content list, unless
the nodes view is what is being opened.

## Working on anything visual

**Look at the page. Do not iterate blind.**

```bash
npm run dev            # :5173  (or use .claude/launch.json "frontend")
npm run test && npm run typecheck
npm run test:e2e       # Playwright, includes visual snapshots
```

Before writing code for a look-and-feel change, get a reference: a screenshot,
a URL, or an existing page in this repo that already does it. A description in
words underdetermines visual design, and a blind round trip costs far more than
asking for the reference.

After writing it: open the page, screenshot it, compare against the reference,
and only then report. "Should look right" is not a result.

If a visual change is hard to pin down, build the smallest isolated version
first — one component, one state — and confirm that before wiring it in.

## Things that bite

- **The local API writes to production.** `backend/.env` points the knowledge
  database at the SSH tunnel to the server. Never call the unit-review write
  endpoints (`POST /knowledge/units/{id}/reviews`,
  `/knowledge/reviews/{id}/messages`, `/knowledge/reviews/{id}/close`) against
  `:8000`, including by clicking through the page. Exercise them through
  `e2e/api-fixture.ts`, which implements the `api.md` §5.6 state machine.
- **Deep links into a unit** are
  `#/knowledge?unit={id}&view=evidence[&tab=structure|verdict|source|review][&review={id}]`.
  The unit does not have to be on the loaded page of the list. Do not fall back
  to the first row: that once silently replaced every old unit linked from the
  asset page with the newest one.
- **Deep links into a verdict** are `#/verification?score={id}` or
  `#/verification?due={unit_id}&horizon={YYYY-MM-DD}`. The page loads all four
  buckets, moves the card window so the record is on screen and opens the
  dialog. `?day=YYYY-MM-DD` sets where the card window starts. All of these use
  `replaceState`, so they never add history entries.
- **The verification page must not scroll.** Rows per screen = card-area
  height ÷ `CARD_MIN_HEIGHT` (`VerificationPage.tsx`); the rows then share the
  height, and the quote shows as many lines as the card has room for. The
  card's fixed parts are budgeted in `CARD_CHROME`; adding a line to the card
  means updating it. `e2e/verification.spec.ts` asserts the page has no
  vertical scroll.
- **Claim thresholds can be tiered by ladder date.** From extraction spec v3,
  `magnitude.target` / `low` / `high` is either a number or
  `{"YYYY-MM-DD": number}` (`api.md` §5.0; unit #1596 is the first). Read them
  only through `magnitudeThresholds(magnitude, day)` in
  `features/asset/format.ts`, passing the record's ladder date
  (`horizon_label`). Reading them with `asNumber` skips tiered values
  silently, and the threshold vanishes from the chart and the headline.
  `grade_note` (why the claim got its grade; in v2 this lived in `asset_text`)
  shows as 定级说明 right after 标的说明 in the unit dossier and the
  verification dialog.
- **e2e runs on a fixed clock** (`FIXTURE_NOW` in `e2e/api-fixture.ts`). Derive
  fixture dates from it, never from `Date.now()`, or screenshot baselines drift
  every day.
