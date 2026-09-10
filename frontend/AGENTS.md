# frontend — Agent Guide

**This is not "the frontend" — it is the knowledge engine's site** (served at
`fanisl.skiuo.com/`). The trading console is a separate application in
`console/`. Shared code is limited to `shared/login/`.

**This is its own seat.** You own `frontend/**` and nothing else. The knowledge
seat owns the backend and the corpus; you consume its API. If you need an API
change, write it into `docs/plans/active/frontend.md` — do not edit
`backend/api.md` or anything under `backend/`.

## Features

`archive` (research archive) · `asset` (asset workbench) · `discovery` ·
`knowledge` (L0/L1 browsing) · `verification` (scoring, source league table)

## Sources of truth

- API contract: `../backend/api.md` — read it, do not guess field shapes
- Domain concepts and the Chinese labels for enums: `../docs/DOMAIN.md`
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
