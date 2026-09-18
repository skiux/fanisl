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
- **The verification page must not scroll.** Cards have a fixed height
  (`--verify-card-h`); cards per screen = columns × rows measured from the card
  area. Adding anything of variable height to a card breaks the arithmetic.
  `e2e/verification.spec.ts` asserts the page has no vertical scroll.
- **e2e runs on a fixed clock** (`FIXTURE_NOW` in `e2e/api-fixture.ts`). Derive
  fixture dates from it, never from `Date.now()`, or screenshot baselines drift
  every day.
