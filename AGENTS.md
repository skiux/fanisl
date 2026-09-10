# fanisl — Agent Guide

> Read this first, every session. Both Claude Code and Codex read this file
> (`CLAUDE.md` is a symlink to it — one source of truth, never fork it).
> Conventions: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).
> Structure: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 1. Two products on one shared base

Do **not** read this repo as "frontend + backend". That puts the boundaries in
the wrong place.

| Product | Backend | Frontend | Served at |
|---|---|---|---|
| **Knowledge engine** | `backend/fanisl/knowledge/` | `frontend/` | `fanisl.skiuo.com/` |
| **Trading console** | `backend/fanisl/trading/` + `binance/` | `console/` | `fanisl.skiuo.com/console/` |
| **Shared base** | `backend/fanisl/` root + `collect/` `chat/` `data/` `auth/` | `shared/` | — |

`frontend/` is a legacy name. **It is not "the frontend" — it is the knowledge
engine's site.** `console/` is a separate application. They share only
`shared/login/`.

## 2. Session ownership

Sessions run in parallel. **Conflicts happen per file, not per feature**, so
ownership is per file. Find your seat, then read that directory's `AGENTS.md`.

| Session | Owns (may edit) |
|---|---|
| **knowledge** | `backend/fanisl/knowledge/**`, `backend/fanisl/assets.py`, `data_export/knowledge_units/`, `docs/research/**` |
| **frontend** | `frontend/**` |
| **console** | `console/**`, `backend/fanisl/trading/**`, `backend/fanisl/binance/**` |
| **base** | `backend/fanisl/` root, `collect/` `chat/` `data/` `auth/` `tools/`, `backend/api.md`, `shared/**`, `deploy/**` |

1. **A contract file has one owner, and the owner is the producer, not the
   consumer.** `backend/api.md` → base. `backend/fanisl/assets.py` → knowledge
   (it is the asset registry; the extraction pipeline discovers new symbols,
   the frontend only reads it).
2. **Do not edit outside your seat.** Write the request into
   `docs/plans/active/<seat>.md` instead. Ownership ambiguity once froze
   `assets.py` for over a week; a dozen symbols went unregistered and their
   units were silently invisible on asset pages.
3. **The two frozen specs belong to the knowledge seat:**
   `knowledge/extraction-guide.md`, `merge-guide.md`. Changing either requires
   bumping `extractor_version` and saying why.
4. `shared/login/` and `docs/DOMAIN.md` are read by several seats. Changing
   them affects both frontends — say so in your report.

Ask-questions / analysis sessions get read-only DB access and docs, not a seat.

## 3. How to work

These exist because each one has already gone wrong here.

**Read the request twice before large or irreversible work.** Requests arrive
in terse Chinese and are easy to under-read. If two readings lead to materially
different work, state your reading in one line and proceed — do not ask about
things you could check yourself. Example of the failure: "把 analyzer 去掉"
means remove one nesting level, not "make `src` the package name".

**Measure instead of asserting.** Before writing "probably", "should be",
"might conflict" — go run something. Claims like "flat layout risks namespace
collisions" turned out to be **0 collisions** when actually measured. This
codebase's docstrings are full of measurements ("52% awake over 9.2 days");
match that standard.

**Verify before you claim.** Never write "done", "fixed", or "works" for
something you have not run. Paste the real output, not a paraphrase of it. If
it failed, say so with the output. The bar per seat:

| Seat | Done means |
|---|---|
| backend / knowledge | `PYTHONPATH=. python -m pytest tests -q` — 534 passed |
| frontend / console | `npm run test && npm run typecheck`, **plus you looked at the page** |
| docs | every markdown link resolves |
| server | `/health` 200 **and** the actual page loads |

**For anything visual, look at it.** Do not iterate blind on CSS and layout.
Start the dev server (`.claude/launch.json` has `frontend` :5173,
`console` :5175, `api` :8000), open it, screenshot it, compare. When the ask is
"make it look like X", get a reference — a screenshot, a URL, an existing page
in this repo — before writing code. Words underdetermine visual design, and a
blind round trip wastes more time than the screenshot costs.

**Deliver the whole request, and say plainly what you did not do.** If part of
the scope is skipped, put that in the report where it cannot be missed, with
the reason — not buried in a commit body. Silently narrowing scope is the
failure mode to avoid.

**Corrections are proportionate.** When told something is wrong, fix that
thing. Do not rewrite everything, and do not swing to the opposite extreme.

**Before anything hard to reverse**, say what you are about to do:
production-database writes, server changes, deleting untracked local data,
`git push`. Back up first when you can — installing new systemd units, for
instance, means copying the old ones aside first.

**Read a file completely before editing it**, and re-read after a rebase or a
long gap. Several incidents here came from acting on a half-read file.

## 4. How to run things

```bash
# Backend (from repo root)
cd backend && source .venv/bin/activate
PYTHONPATH=. uvicorn fanisl.main:app --reload      # API on :8000
python -m pytest tests -q                          # 534 tests

# Frontends
cd frontend && npm run dev      # knowledge engine site, :5173
cd console  && npm run dev      # trading console, :5175
npm run test && npm run typecheck

# Read-only health checks (check_ingest does NOT ingest)
cd backend && PYTHONPATH=. python tools/check_db.py
cd backend && PYTHONPATH=. python tools/check_ingest.py
```

**The knowledge database is remote.** Only `PG_KNOWLEDGE_CONNINFO` tunnels over
SSH to the server (the single source of truth); `PG_CONNINFO` and
`PG_TRADING_CONNINFO` point at empty local dev databases. So `check_ingest.py`
run locally shows zeros in its first two sections — expected, and **not** a sign
that collection has stopped.

## 5. Things that bite

- **The server pulls `origin/main` and restarts every 5 minutes.** Pushed code
  goes live fast; failures roll back automatically (`deploy/auto-update.sh`).
- **systemd units under `/etc/systemd/system` are copies, not symlinks.**
  `git pull` does not touch them. Changing `deploy/*.service` requires
  `sudo install` **and then** `daemon-reload` — reload alone does nothing.
  auto-update detects this drift and fails loudly rather than fixing it.
- **`auto-update.sh` updates itself.** Its body is wrapped in `{ ... }` so bash
  parses the whole file before executing. Do not remove those braces.
- **Restarting the collector re-runs every scheduled job immediately**
  (`Scheduler(run_immediately=True)`), including knowledge daily and weekly.
- **Docs are part of the deliverable.** Behaviour change and doc change go in
  the same commit. Module docs sit next to the implementation; `docs/` holds
  only cross-module material.
- **Extracted quotes must be verbatim.** Import checks `quote ∈ source text`
  and rejects the whole file on any miss.
