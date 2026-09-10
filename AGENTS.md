# fanisl — Agent Guide

> Read this first, every session. Both Claude Code and Codex read this file
> (`CLAUDE.md` is a symlink to it — one source of truth, never fork it).
> Conventions: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).
> Structure: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 1. This repo is two products on one shared base

Do **not** read this repo as "frontend + backend". That framing puts the
boundaries in the wrong place.

| Product | Backend | Frontend | Served at |
|---|---|---|---|
| **Knowledge engine** | `backend/fanisl/knowledge/` | `frontend/` | `fanisl.skiuo.com/` |
| **Trading console** | `backend/fanisl/trading/` + `binance/` | `console/` | `fanisl.skiuo.com/console/` |
| **Shared base** | `backend/fanisl/` root + `collect/` `chat/` `data/` `auth/` `tools/` | `shared/` | — |

`frontend/` is a legacy name. **It is not "the frontend" — it is the knowledge
engine's site.** `console/` is a separate application. The only thing they share
is the login page in `shared/login/`.

## 2. Session ownership

Multiple sessions work in parallel. **Conflicts happen per file, not per
feature**, so ownership is assigned per file:

| Session | Owns (may edit) | Delivers |
|---|---|---|
| **Knowledge engine** | `backend/fanisl/knowledge/**`, `backend/fanisl/assets.py`, `frontend/**`, `data_export/knowledge_units/`, `docs/research/**` | L0→L6 correctness, the site |
| **Trading console** | `backend/fanisl/trading/**`, `backend/fanisl/binance/**`, `console/**` | accounts, orders, risk |
| **Base & ops** | `backend/fanisl/` root, `collect/` `chat/` `data/` `auth/` `tools/`, `backend/api.md`, `shared/**`, `deploy/**` | service uptime, contract stability |

Three rules:

1. **A contract file has exactly one owner, and the owner is the producer, not
   the consumer.** `backend/api.md` belongs to the base session.
   `backend/fanisl/assets.py` belongs to the knowledge engine — it is the asset
   registry, and the extraction pipeline is what discovers new symbols; the
   frontend only reads it.
2. **Cross-boundary needs go into `docs/plans/active/`, not into a direct
   edit.** Ownership ambiguity once froze `assets.py` for over a week; a dozen
   symbols went unregistered and their units were invisible on asset pages.
3. **The two frozen specs are maintained by the knowledge-engine session:**
   `backend/fanisl/knowledge/extraction-guide.md` and `merge-guide.md`.
   Changing either requires bumping `extractor_version` and saying why.
   Other sessions must not touch them.

A "general questions / market analysis" session needs read-only DB access and
good docs, not a code seat. Do not give it one.

## 3. How to run things

```bash
# Backend (from repo root)
cd backend && source .venv/bin/activate
PYTHONPATH=. uvicorn fanisl.main:app --reload      # API
python -m pytest tests -q                          # 534 tests — always run after backend changes

# The two frontends
cd frontend && npm run dev      # knowledge engine site
cd console  && npm run dev      # trading console
npm run test && npm run typecheck                   # always run after frontend changes

# Database connectivity / ingest health (read-only, does NOT ingest)
cd backend && PYTHONPATH=. python tools/check_db.py
cd backend && PYTHONPATH=. python tools/check_ingest.py
```

**The knowledge database is remote.** Of the three databases, only
`PG_KNOWLEDGE_CONNINFO` tunnels over SSH to the server (the single source of
truth). `PG_CONNINFO` and `PG_TRADING_CONNINFO` point at empty local dev
databases. So when `check_ingest.py` runs locally, its first two sections read
the local market DB and show zeros — that is expected and does **not** mean
collection has stopped on the server.

## 4. Things that bite

- **The server pulls `origin/main` and restarts every 5 minutes.** Anything
  pushed goes live quickly; failures roll back automatically
  (`deploy/auto-update.sh`).
- **Changing a systemd unit requires `daemon-reload`** — auto-update does not
  do this step.
- **Docs are part of the deliverable.** Change behaviour, change the docs in the
  same commit. Module docs live next to the implementation; `docs/` holds only
  cross-module material. Rationale in `docs/CONVENTIONS.md`.
- **Extracted quotes must be verbatim.** Import mechanically checks
  `quote ∈ source text` and rejects the whole file on any miss.
