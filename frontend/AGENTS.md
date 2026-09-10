# frontend — Agent Guide

**This is not "the frontend" — it is the knowledge engine's site** (served at
`fanisl.skiuo.com/`). The trading console is a separate application in
`console/`. The only shared code is `shared/login/` at the repo root.

**Owned by the knowledge-engine session.**

- Features: `archive` (research archive), `asset` (asset workbench),
  `discovery`, `knowledge` (L0/L1 browsing), `verification` (scoring and the
  source league table)
- The backend contract is `../backend/api.md`. Domain concepts are in
  `../docs/DOMAIN.md`; product definition and information architecture are in
  `../docs/PRODUCT.md`
- `npm run dev` / `npm run test` / `npm run typecheck`; e2e uses Playwright
- `../shared/` sits at the repo root and both apps' tsconfigs include it —
  editing it also affects `console/`
