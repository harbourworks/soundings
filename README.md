# Soundings

**Evidence-backed answers to security questionnaires, run locally.**

Soundings scans a project on your own machine and records what it finds: which AI providers it calls, where data is stored and sent, how users sign in, how keys are handled. Answers to a client's security questionnaire are then built from those findings, and anything the code can't tell it becomes a question for you. Your code never leaves your machine.

Status: 0.1.0. Scanning, questions, answers, questionnaire import, verification, licensing, the five documents and the exports work. Nothing is published yet. Available on npm as `soundings-cli`.

```
soundings scan .                         # what does the code show?
soundings questions                      # ask only what it can't
soundings answers --output answers.md    # 43 standard questions, every sentence sourced
soundings answer client.csv              # fill in a client's questionnaire (never guesses)
soundings document privacy-notice        # also: subprocessors, dpia, ai-use, trust-page
soundings verify draft.md                # check any text against the evidence
```

```
  Soundings 0.0.1  ·  notes-saas  ·  nextjs, react, stripe, supabase-js
  10 files, 14 detectors, 64 ms. Your code never left this machine.

  AI providers
   EV-3acc7131  OpenAI  [stated by the code]
     The app uses the OpenAI SDK from server code.
     app/api/summarise/route.ts:1
  ...
  Only you can answer these (3)
   UQ-supabase-region  In which region is the Supabase project hosted?
     Hosting is set up outside the code, so a scan can't see it.
```

## What it does

- **Scans locally.** No network calls, no telemetry, no upload. It reads JavaScript and TypeScript projects (Next.js, Node/Express, Supabase, Firebase, Stripe and the main AI SDKs) and reports anything else as "couldn't determine".
- **Writes evidence, not code.** `soundings-evidence.json` holds file paths, line numbers and one-sentence claims. It never holds source code or secret values, and the scan fails loudly if a secret would end up in it.
- **Says how sure it is.** Each fact is stated by the code, inferred, or "not found by the scan". An empty search is never presented as proof.
- **Asks instead of guessing.** What the code can't show (a hosting region, an account setting at a provider, how long data is kept) becomes a question with a stable ID.

- **Answers a standard question bank.** 43 questions on AI use, data, access, keys, logging, suppliers and incident response. Each sentence cites a scan fact or something you said, and the document ends with numbered sources. If your answer and the scan disagree, yours wins and the document notes the difference.

- **Fills in a client's questionnaire.** Rows that clearly match a bank question are answered; everything else is marked and listed, never guessed.
- **Checks any text.** `soundings verify` fails any statement without a real source that mentions what it claims, so an AI assistant's draft can be trusted only as far as it can be checked.

Scanning, questions and verification are free and make no network calls. The answers documents and questionnaire import are Soundings Pro; see [docs/plans.md](docs/plans.md) for exactly what the one licence check sends.

- **Writes the documents.** Privacy notice, subprocessor list, impact assessment draft, AI-use statement and trust page, as Markdown, a self-contained HTML page (print it for a PDF) or a Word file with real footnotes. Anything the code and your answers can't say is listed as needing your input, never filled in.

See [docs/documents.md](docs/documents.md), [docs/questions.md](docs/questions.md), [docs/questionnaires.md](docs/questionnaires.md), [docs/verify.md](docs/verify.md), [docs/detectors.md](docs/detectors.md) for what each detector reads and where it stops, and [docs/evidence-format.md](docs/evidence-format.md) for the file format.

## Options

```
soundings [scan] [path]     Scan a project (default: current folder)
soundings questions         Ask only what the code can't answer (--list, --set key=value)
soundings answers           Answer the question bank (--output, --format markdown|json, --no-locations)
  --output <file>           Where to save the evidence (default: ./soundings-evidence.json)
  --no-write                Print the report but don't save the file
  --format terminal|json    Report format
  --seaworthy <file>        Include findings from a Seaworthy JSON report
  --config <file>           Config file (default: <path>/soundings.config.json)
soundings answer <file.csv> Fill in a client questionnaire (CSV)            Pro
soundings document <type>   Privacy notice, subprocessors, dpia, ai-use, trust-page   Pro
soundings buy | login <key> | logout | status    Plans and licence
soundings verify <file>     Check text against the evidence (--strict, --format json)
```

Soundings produces drafts. It is not legal advice and does not say that anyone is compliant with anything.

## Licence

Source-available. See [LICENSE](LICENSE) and [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).
