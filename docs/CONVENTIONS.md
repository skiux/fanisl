# CONVENTIONS

> Ownership and how to run things: [`AGENTS.md`](../AGENTS.md) at the repo root.
> This file covers *how to write*.

## Language

| What | Language | Why |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md`, this file | **English** | Agents act on these. English removes ambiguity |
| Commit messages, code comments | Chinese | Written for the maintainer, read in `git log` and in context |
| `docs/PRODUCT.md`, `DOMAIN.md`, `research/`, `data/` | Chinese | Domain material; the corpus itself is Chinese |
| `extraction-guide.md`, `merge-guide.md` | Chinese | See below |
| `docs/decisions/README.md`, `plans/` README-style rules | **English** | Instructions |
| Individual decision records and plans | Chinese | Records, not instructions |
| Identifiers, file names, directory names | English | — |

The rule underneath the table: **instructions are English, records and domain
material are Chinese.** A guide an agent must follow should not depend on
reading Chinese correctly; a record of what happened is written for whoever
maintains this.

The two frozen specs stay in Chinese deliberately. They quote Chinese
transcripts verbatim, their domain vocabulary (claim 分级, 标的, 屏价, 可评性)
has no settled English equivalent in this project, and every rule is
cross-referenced by section number. Translating them would risk changing
meaning in the one place where meaning must not drift. Revisit only if a
non-Chinese-reading agent ever has to run extraction.

## AGENTS.md and CLAUDE.md

**One file, two names.** `AGENTS.md` is the real file (read by both Codex and
Claude Code); `CLAUDE.md` is a symlink to it. Never write two copies — they
will diverge, and a forked guide is worse than no guide. Do the same for any
new per-directory guide.

## Where documentation goes

- **Module docs live next to the implementation.**
  `backend/fanisl/knowledge/README.md`, `binance/README.md`, `auth/README.md`
  are each in their own directory, because that is the first thing someone
  working in that directory needs.
- **`docs/` holds only cross-module material.** It is not a dumping ground:
  anything that describes a single module belongs back in that module.
- **Contracts follow the producer.** `backend/api.md` sits under `backend/`
  rather than in `docs/` because it changes with the backend code (11 edits in
  the last 60 commits).

## What goes in each `docs/` subdirectory

| Directory | Contents | Not for |
|---|---|---|
| `decisions/` | Technical decisions already made: context, alternatives, evidence, consequences. Never edited after the fact — if one turns out wrong, write a new one that supersedes it | plans, TODOs |
| `plans/active/` | Work in progress, including outstanding debt. Move to `completed/` when done | finished work |
| `plans/completed/` | Finished plans, kept for reference | — |
| `research/` | Hypothesis pre-registrations (`prereg/`), adjudication log, research capstone | product design |
| `data/` | Data layer: sources and gaps, inventory, schema, sync discipline | — |
| `archive/` | Superseded documents. The first line must say what superseded it | anything still in use |

## Docs are part of the deliverable

Change behaviour, change the docs in the same commit. Two documentation audits
each turned up roughly 20 stale statements, all from the same cause: the code
moved and the docs did not.

**If a number can be checked mechanically, check it.** The design doc carried
"39 symbols" long after the real count was 90, and "103 overrides" when it was
77. Either leave such numbers out or assert them in a test.

## Comments and commit messages

Write **why**, not what. The diff already says what.

Include measurements when you have them: "on macOS `time.monotonic()` does not
advance during sleep; measured 52% awake over 9.2 days of uptime on the dev
machine" is far more useful than "wall clock is more reliable".

Leave the traps where you found them. A deleted trap gets stepped in again.

## Frozen specs

`extraction-guide.md` and `merge-guide.md` under `backend/fanisl/knowledge/`
are **frozen**: changing them requires bumping `extractor_version`, and output
produced under older versions is retained, never rewritten (versioned replay).
A change that only affects how fields are filled in — not grading, not scoring
semantics — may skip the version bump, but must say so explicitly.
