# knowledge — Agent Guide

The knowledge engine, layers K0-K6. **This directory is owned by the
knowledge-engine session**, as is `backend/fanisl/assets.py`.

## Read these first

1. `README.md` — module map: what each file does, the data flow, daily operation
2. `extraction-guide.md` — L1 extraction spec, **v2, frozen**. Changing it
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
- **Spot checks settle per batch:** 20% of every batch (§10). Do not start the
  next batch before the current one is settled.
- Semantics the five scorers cannot express (resistance-holds, comparison
  operators for step-function series) are registered in
  `scoring_overrides.json`; `success_def` remains the semantic arbiter.

## Common commands

```bash
cd backend && source .venv/bin/activate
python -m fanisl.knowledge.backfill_transcripts @yttalkjun --since-days 4   # ingest (costs Gemini quota)
python -m fanisl.knowledge.import_units <file.json> --dry-run               # validate only
python -m fanisl.knowledge.scorers --freeze-refs
python -m fanisl.knowledge.spotcheck sample 10
```

Ingestion runs automatically in the collector's daily job (24-hour interval), so
a newly published episode may take up to about a day to land.
`backend/tools/check_ingest.py` is read-only and does **not** ingest.
