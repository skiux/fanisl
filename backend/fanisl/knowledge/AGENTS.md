# knowledge — Agent Guide

The knowledge engine, layers K0-K6. **This directory is owned by the
knowledge-engine session**, as is `backend/fanisl/assets.py`.

## Read these first

1. `README.md` — module map: what each file does, the data flow, daily operation
2. `extraction-guide.md` — L1 extraction spec, **v3, frozen**. Changing it
   requires bumping `extractor_version`
3. `merge-guide.md` — K5 merge spec v1, also frozen
4. `../../../docs/knowledge-engine-design.md` — layered design and phase criteria

Both specs are written in Chinese because the corpus, the quotes, and the
domain vocabulary are Chinese; translating them would risk changing their
meaning. Read them as-is.

## Invariants

- **Quotes are verbatim.** Import mechanically checks `quote ∈ source text`
  (whitespace-normalised substring) and rejects the entire file on any miss.
  The quote is the sole arbiter when a score is disputed.
- **A/B/C claims must carry a frozen `ScoringSpec`; D claims must not**
  (enforced in `models.py`). The D share is itself a source-quality metric.
- **Non-price judgements must not be mechanised into price claims.** The test
  question: did the author actually say what the price would do?
- **Spot checks settle per batch:** 20% of every batch (§10), with every A/B/C
  claim in the batch included. Do not start the next batch before the current
  one is settled.
- **Machine scoring rules live in the unit's `scoring_spec`** (v3: `bounds`, `op`,
  `baseline_date`, `condition`, `vs`). Import rejects a file whose A/B/C specs the
  scorer cannot parse. `scoring_overrides.json` holds the same rules for v1/v2
  units only; `success_def` remains the semantic arbiter.
- **Contents with `status='reference'` are not extracted.** They are ingested
  for reading only (channels in `store.REFERENCE_HANDLES`, currently
  @MeiTouNews: daily news, kept for its news and learning value — the user's
  call, 2026-09-24). Pick extraction work from `status='new'`.
- **Look back when an episode refers to an earlier one.** Find the older units on
  the same asset and classify: misread → `review amend`; detail added before the
  outcome was known → may inform the old unit, cite it; changed view → new unit;
  after-the-fact self-review → not extracted, but check the old unit anyway.

## Processing unit reviews

Users flag units from the site (the 核查 tab in a unit's dossier). Each flag is a row
in `unit_reviews` with status `open`, and the open ones are this seat's queue.
Answers go through `python -m fanisl.knowledge.review` only — there is no HTTP path
for them, by design.

For each open review:

1. `review show <id>` — the user's messages, the unit, its scores, prior amendments.
2. **Re-read the source passage** around the quote in `contents.raw`, then judge
   against the frozen spec. Not against the user's framing, and not against your
   memory of how the unit was extracted. The user may be right; the spec may be
   right against the user. Say which, and cite the passage.
3. If the unit is wrong, fix it with
   `review amend <unit_id> --review <id> --reason …`. An amendment re-runs payload
   validation and the quote-in-source check, is stored with before and after, and
   is refused on scoring fields once the unit has scores.
4. Answer with `review answer <id> --outcome …`:
   - `fixed` requires an amendment on this review, plus `--root-cause` (why the
     error happened) and `--sweep` (which similar units you checked, and what you
     found). The store rejects the answer without all three.
   - `no_change` must cite the passage and the rule that support the original.
   - `needs_info` must state exactly what is missing.
   If a scored ladder point should never have existed (the horizon was misread and an
   extra ladder got scored), void it with `review void <unit_id> <horizon_label> --reason …`.
   The row moves to `claim_score_voids` intact and drops out of every statistic. Voiding is
   not a way to fix a wrong outcome, and a unit with voided scores still counts as scored:
   its scoring fields stay locked.
5. If the cause is systematic — a spec gap, a pattern that recurs across units —
   write it in `--followup` and add it to `docs/plans/active/knowledge.md`.
   Fixing only the unit the user happened to see is the failure this workflow
   exists to prevent.

Do not record flagged units in `spot_checks`. That table is the §10 random sample;
user-selected units would bias its faithfulness rate.

## Common commands

```bash
cd backend && source .venv/bin/activate
python -m fanisl.knowledge.backfill_transcripts @yttalkjun --since-days 4   # ingest (costs Gemini quota)
python -m fanisl.knowledge.import_units <file.json> --dry-run               # validate only
python -m fanisl.knowledge.scorers --freeze-refs
python -m fanisl.knowledge.spotcheck sample 10
python -m fanisl.knowledge.review list                                      # open reviews = this seat's queue
python -m fanisl.knowledge.audit                                            # read-only health check; run after every batch
```

Ingestion runs automatically in the collector's daily job (24-hour interval), so
a newly published episode may take up to about a day to land.
`backend/tools/check_ingest.py` is read-only and does **not** ingest.
