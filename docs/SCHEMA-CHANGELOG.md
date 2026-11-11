# Schema changelog

The evidence schema is versioned in `schemaVersion`. Every change to its shape is recorded here and bumps the version.

## 0.2 (11 November 2026)

First version in this repository. Differences from the earlier 0.1 draft:

- **Stable IDs.** Fact and finding IDs are derived from content (`EV-3acc7131`), not from sort position (`EV-003`), so adding a fact never renumbers the others. Unknown IDs are readable slugs (`UQ-supabase-region`).
- **`scan` block.** Files scanned and skipped, detectors run, detectors skipped with a reason.
- **`claimType`** on facts: `observed` or `not-found`. A `not-found` fact can't be `high` confidence.
- **`key`** on facts: the stable discriminator an ID is derived from, usually a file path.
- **Findings are citable.** Each has an `F-` ID and optional `relatedFacts`, so a finding that pulls against a fact is visible.
- **Marker syntax** accepts several IDs in one bracket (`[EV-3acc7131, A-001]`) and reserves `F-` and `KB-`.
- **`scan.unsupported`:** source files in languages Soundings doesn't read, by language. When there are enough of them the scan raises `UQ-unanalysed-code` and makes no "not found" claims.
- **Conventional attributes** `purpose`, `dataCategories` and `region` for the subprocessor list.
