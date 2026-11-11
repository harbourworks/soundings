# Evidence file format (schema 0.2)

`soundings scan` writes `soundings-evidence.json`. Everything Soundings later writes about your project comes from this file and from answers you give, never from your source code. The file holds paths, line numbers and one-sentence claims. It never holds code or secret values, and a file that sets `containsSourceCode` to anything but `false` is invalid.

The definition is [`src/evidence/schema.ts`](../src/evidence/schema.ts). A worked example is [`examples/acme-notes.evidence.json`](../examples/acme-notes.evidence.json).

## Principles

1. **Facts, not code.** Paths, line numbers and short claims. No snippets, no secret values.
2. **Every fact has a source.** A detector and, where one exists, a location.
3. **Confidence is honest.** `high` means the code states it directly. `medium` is inferred. `low` is a guess: it is shown to you as unconfirmed and never written into a document.
4. **Absence is weaker than presence.** A `not-found` claim ("no hard-coded keys matching known formats were found") can never be `high`, because a pattern search coming up empty is not proof.
5. **Unknown is a result.** If the code can't say (a hosting region, an account setting at a provider, how long data is kept), the file contains an `unknown` with a question for you. Nothing fills the gap.
6. **The file says what was checked.** The `scan` block lists the files covered and the detectors that ran or were skipped, so a missing fact can be told apart from something that was never looked for.
7. **Deterministic.** The same project produces the same file apart from `generatedAt`.
8. **Your answers live elsewhere.** `soundings-answers.json` holds them (`A-001`, ...). The evidence file is never edited by hand.

## Identifiers

IDs come from content, not position, so adding a fact never renumbers the others, and your answers and any document footnotes survive a re-scan.

| Prefix | What | Example |
| --- | --- | --- |
| `EV-` | A fact: 8 hex characters derived from its kind, subject, detector and key | `EV-3acc7131` |
| `F-` | A finding from Seaworthy, when it is available | `F-1a2b3c4d` |
| `UQ-` | A question the code can't answer: a readable slug | `UQ-supabase-region` |
| `A-` | Your answer, numbered in the order you give them | `A-001` |
| `KB-` | Reserved for passages from your own documents | `KB-0f1e2d3c` |

## Fact kinds

`ai_provider`, `third_party_service`, `data_flow`, `data_store`, `auth`, `secret_handling`, `logging`, `region`, `retention`, `client_side_exposure`.

For the subprocessor list, facts use the attribute names `purpose`, `dataCategories` and `region`.

## How documents refer to evidence

Every sentence in a generated document that says something about your project ends with one or more markers, such as `[EV-3acc7131]` or `[EV-3acc7131, A-001]`. The renderer turns them into footnotes. A marker that doesn't exist, or a project-specific sentence with none, is rejected.

How a fact may appear in a document depends on its confidence: `high` can be stated plainly, `medium` and `not-found` only with a visible qualifier, `low` never.

## Redaction guard

Soundings checks the evidence file, its own logs and every generated document for known secret formats and for any value found in your project's `.env` files (template files such as `.env.example` are ignored, as are public-prefixed names like `NEXT_PUBLIC_*`). It fails loudly on a match. The error names the kind of leak and where, never the value, and env values are held in memory only.
