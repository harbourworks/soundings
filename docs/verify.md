# Verifying a document

```
soundings verify draft.md
```

`verify` checks any text against your evidence file and your answers: a document Soundings wrote, or a draft from an AI assistant or a colleague. It is how you can use an assistant to write fluent prose without trusting it to get the facts right. It runs locally, with no model and no network.

Exit code 0 means no errors, 1 means it found problems, 2 means it couldn't run. Add `--strict` to treat warnings as failures, or `--format json` for tooling.

## What it checks

Each sentence about the project must point to a source, written `[EV-3acc7131]` (a scan fact), `[A-001]` (your answer) or `[F-1a2b3c4d]` (a Seaworthy finding). Footnote marks such as `[^EV-3acc7131]` count too.

| Check | Fails when |
| --- | --- |
| `missing-reference` | A sentence names a service, a number or a place and cites nothing |
| `unknown-reference` | A marker points at an ID that isn't in the evidence or answers |
| `entity-not-in-source` | A sentence names a service (say Anthropic) that none of its cited sources mention |
| `number-not-in-source` | A sentence uses a number (such as "30 days") that its sources don't contain |
| `place-not-in-source` | A sentence names a place (London, Ireland, eu-west-2) its sources don't mention |
| `absence-contradicts-source` | A sentence says something is absent or not done, but the cited fact shows it is present |
| `presence-from-not-found` | A sentence says something is present, but the only cited fact is a "not found" result |
| `unqualified-inference` | A sentence rests only on an inferred fact and doesn't say so ("appears to", "inferred from the code") |
| `low-confidence-fact` | A sentence cites a low-confidence fact. Those stay out of documents until you confirm them |
| `overclaim` | Wording that implies legal assurance: "compliant", "certified", "guaranteed", "fully secure" |

Warnings, which don't fail the run unless you use `--strict`: a sentence that sounds like a statement about your project but cites nothing (`unreferenced-statement`), and a document with no draft notice (`missing-notice`).

You can state your own certifications. A sentence that cites one of your answers isn't flagged for wording like "certified", because it is your statement and is attributed to you.

## What it does not check

It can prove a sentence is **unsupported**. It cannot prove one is **true**. Passing means every statement points to a source that exists and mentions what the sentence mentions. It doesn't mean the source is right, or that a sentence says what its source means. It also can't catch a claim that names nothing it recognises. It knows the services Soundings detects and the usual cloud and SaaS names, so a vendor outside that list is checked only if it appears in your evidence.

It skips headings, questions, code blocks, the sources list and "Needs your input" prompts.

## In a workflow with an AI assistant

1. `soundings scan .` and `soundings questions`.
2. Give the assistant `soundings-evidence.json` and `soundings-answers.json` (they contain no code or secrets) and ask it to cite every statement with the IDs.
3. `soundings verify draft.md`. Send the failures back to the assistant, or fix them by hand.
