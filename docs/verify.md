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
| `flow-not-in-source` | A sentence says data is sent to an AI provider ("sent to", "sends … to", "passed to", "transmitted to", "forwarded to", "uploaded to", "shared with", "included in prompts", in any verb form), naming the provider as who receives it (right after the "to" or "with", in the same clause: "sent to the model hosted by Anthropic" counts, "sent to Sentry, and the app uses the Anthropic SDK" and "sent to Sentry and OpenAI is used for chat" do not), and cites that provider's "uses the SDK" fact but no data-flow fact for it. The SDK fact only shows that the code uses the provider; that data reaches it is a separate data-flow fact. Not applied when the sentence also cites one of your answers, or says the data is not sent |
| `unqualified-inference` | A sentence rests only on an inferred fact and doesn't say so ("appears to", "inferred from the code") |
| `low-confidence-fact` | A sentence cites a low-confidence fact. Those stay out of documents until you confirm them |
| `overclaim` | Wording that implies legal assurance: "compliant", "certified", "guaranteed", "fully secure" |

Warnings, which don't fail the run unless you use `--strict` (the summary then says `Failed`):

- `unreferenced-statement`: a sentence that cites nothing but reads as a claim about your project. That is one that talks about "we", "our" or "the app"; one that puts a capitalised name the evidence doesn't mention where a vendor would go ("handled by PayPal", "stored in Snowflake", "sent to X", "with X"); or one that pairs a negative ("no", "never", "not", "none", "without", "nothing", "isn't" and the like) with one of the verbs send, share, store, log, transmit, collect, upload, retain, sell or leave, in any form ("sends", "sent", "sending" and so on: "No user content is ever sent to an AI provider", "We do not sell personal data").
- `missing-notice`: a document with no draft notice.

You can state your own certifications. A sentence that cites one of your answers isn't flagged for wording like "certified", because it is your statement and is attributed to you.

## What it does not check

It can prove a sentence is **unsupported**. It cannot prove one is **true**. Passing means every statement points to a source that exists and mentions what the sentence mentions. It doesn't mean the source is right, or that a sentence says what its source means. It knows the services Soundings detects and the usual cloud and SaaS names, and an uncited sentence naming one of those is an error. A vendor outside that list is only a warning, and only when it is capitalised and comes straight after "by", "in", "to" or "with". A claim that names nothing it recognises and fits none of the patterns above passes unnoticed.

It skips headings, questions, code blocks, the sources list and "Needs your input" prompts.

## In a workflow with an AI assistant

1. `soundings scan .` and `soundings questions`.
2. Give the assistant `soundings-evidence.json` and `soundings-answers.json` (they contain no code or secrets) and ask it to cite every statement with the IDs.
3. `soundings verify draft.md`. Send the failures back to the assistant, or fix them by hand.
