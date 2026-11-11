# Soundings

**Evidence-backed answers to security questionnaires, run locally.**

Soundings scans a project on your own machine and records what it finds: which AI providers it calls, where data is stored and sent, how users sign in, how keys are handled. Answers to a client's security questionnaire are then built from those findings, and anything the code can't tell it becomes a question for you. Your code never leaves your machine.

Status: pre-release, under construction. Scanning works; questions, answers and documents are being built. Nothing is published yet.

```
soundings scan .
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

See [docs/detectors.md](docs/detectors.md) for what each detector reads and where it stops, and [docs/evidence-format.md](docs/evidence-format.md) for the file format.

## Options

```
soundings [scan] [path]     Scan a project (default: current folder)
  --output <file>           Where to save the evidence (default: ./soundings-evidence.json)
  --no-write                Print the report but don't save the file
  --format terminal|json    Report format
  --seaworthy <file>        Include findings from a Seaworthy JSON report
  --config <file>           Config file (default: <path>/soundings.config.json)
```

Soundings produces drafts. It is not legal advice and does not say that anyone is compliant with anything.

## Licence

Source-available. See [LICENSE](LICENSE) and [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).
