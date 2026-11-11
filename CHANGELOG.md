# Changelog

All notable changes to soundings-cli. Versions follow [semantic versioning](https://semver.org); while it's 0.x, a minor version can change behaviour.

## Unreleased

- **`soundings verify`:** the claim validator. Checks any text against the evidence: every statement about the project needs a source that exists and mentions what the sentence mentions (services, numbers, places), absence and presence must agree with the cited fact, inferred facts must be worded as inferred, and wording that implies legal assurance is rejected. Local, no model.
- **`soundings answer <file.csv>`:** fills in a client questionnaire from the bank. Unclear rows are marked and listed, never guessed; filled cells are left alone; the original is never overwritten.
- **`soundings questions`:** asks only what the code can't answer (scan questions with stable IDs, plus profile questions about how your team runs), saves `soundings-answers.json`, and reuses answers across runs. `--set` for scripts; secrets are refused.
- **`soundings answers`:** answers a bank of 43 standard questions from evidence and your answers, as Markdown with numbered sources or as JSON. If your answer overrides the scan, the document says so.
- The scan now records qualified "not found" facts (no AI provider, database, sign-in, request-body logging or browser-exposed secret found), so an answer like "we don't use AI" has something honest to cite.
- **`soundings scan`:** a local scanner with 35 detectors for AI providers, data sent to them, third-party services, sign-in, data stores (with Supabase row-level security state), secret handling, request-body logging and browser exposure. It writes the evidence file and prints a plain-English report.
- Questions the code can't answer are raised with stable IDs (`UQ-supabase-region`).
- Optional `--seaworthy` report ingestion, linked to the facts each finding bears on.
- Self-scan in CI.
- Evidence schema 0.2 with content-derived IDs, scan coverage and a claim-marker parser.
- Redaction guard that fails on secret formats and on values from the project's `.env` files.
- Three fixture projects with answer keys, including decoys a scan must not report.
- CI: typecheck, tests and build on every pull request.
