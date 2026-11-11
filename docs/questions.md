# Questions and answers

Soundings answers a standard bank of 43 questions across seven areas (AI use, data handling, access control, key management, logging and monitoring, suppliers, organisation and incident response). Every sentence in an answer comes from one of two places: the scan, or something you told it. Nothing is written freehand, and every sentence carries a reference such as `[EV-3acc7131]` (a scan fact) or `[A-001]` (your answer).

```
soundings scan .                 # writes soundings-evidence.json
soundings questions              # asks only what is left, saves soundings-answers.json
soundings answers --output answers.md
```

## What `questions` asks

Two kinds of thing, and only what is still unanswered:

- **Scan questions** (`UQ-…`) that the code can't answer, such as `UQ-supabase-region` or `UQ-openai-data-use`. Their IDs come from what the scan found, so they stay the same between scans.
- **Profile questions** (`profile.…`) about how your team runs, such as incident response, staff vetting and backups. You answer each once and every future questionnaire reuses it.

Press Enter to skip a question. Answers are saved after each one. In scripts, use `--set`:

```
soundings questions --set UQ-supabase-region="London (eu-west-2)" --set profile.mfa="Required for admins"
soundings questions --list       # what is left, without asking
```

An answer that looks like a key or token is refused: answers end up in documents sent to clients.

## When your answer and the scan disagree

Your answer wins. Use `override.<question-id>`:

```
soundings questions --set override.ai-use="We use a self-hosted model only"
```

The document then says "Stated by the project team: …" and adds a line noting what the code scan reported, so a reader sees both.

## What `answers` produces

A Markdown document (or JSON with `--format json`) with:

- the draft notice at the top, which every generated document carries;
- each question with its answer, or **Needs your input** with what is missing;
- a **Sources** section listing every reference as a numbered footnote. Add `--no-locations` to leave file paths out when the document goes to a client.

How sure the scan is shows in the wording. A fact the code states is said plainly. An inferred one ends "(inferred from the code, not confirmed)". A "not found" fact says what was searched, for example "No AI provider SDK from the supported list was found", and is never presented as proof that something doesn't exist.

## "Not found" facts

So that an answer like "we don't use AI" has something honest to cite, the scan records a medium-confidence "not found" fact when it finds no AI provider, database, sign-in method, request-body logging or browser-exposed secret. They are limited to the supported technologies, which is why they are never `high` confidence.
