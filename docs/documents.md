# Documents

Five documents, each built only from the scan and your answers. They need Soundings Pro (see [plans](plans.md)).

```
soundings document                       # list them
soundings document privacy-notice
soundings document subprocessors --format html --output subprocessors.html
soundings document dpia --format docx --output dpia.docx
```

| Document | What it covers |
| --- | --- |
| `privacy-notice` | Who is responsible, what personal data is handled, why, who receives it, where it is stored, how long it is kept, how it is protected, AI use, people's rights |
| `subprocessors` | A table of the external services the code integrates with: purpose, data, location |
| `dpia` | A draft impact assessment: the processing, necessity, what the code shows that bears on risk, measures, consultation, sign-off |
| `ai-use` | Which AI providers are used, for what, with what data, how providers may use it, oversight, where it is processed |
| `trust-page` | A short, client-facing summary of security and data handling, with suppliers and contacts |

## How a document is made

- Each section is assembled from the same evidence-backed answers as the [question bank](questions.md). Every sentence about your project ends with a source marker, and every marker becomes a numbered footnote with the source named under **Sources**.
- Where the scan and your answers can't say, the document says **Needs your input** and the item is listed under **Open items**. Nothing is filled in to make a section look complete. `soundings questions --documents` asks for exactly those items.
- A fact the scan only inferred is worded as inferred. A "not found" fact says what was searched.
- Add `--no-locations` to leave file paths out of the sources when a document goes to a client.

## Fixed wording

A few passages are fixed text that ships with Soundings: the introductions, the statement of people's rights in the privacy notice, and the sign-off line in the impact assessment. They are general statements, not claims about your project, so they carry no source. They are listed in [`src/documents/templates.ts`](../src/documents/templates.ts), are not produced or reworded by any model, and carry legal weight, so the owner reviews them before each release. The verifier skips a sentence only if it matches that wording exactly.

Every document carries the draft notice at the top, and none says that anyone is compliant with, or certified to, anything. Read each one before it goes to anyone, and have the people responsible approve the impact assessment.

## Formats

- `--format markdown` (the default) prints to the screen, or saves with `--output`.
- `--format html` writes one self-contained page: no scripts, no external files, light and dark themes. **To make a PDF, open it and print to PDF**; the page has a print layout.
- `--format docx` writes a Word file with real footnotes. It needs `--output`. It is written without any template or macro, and has been checked by loading it with an independent library, not yet by opening it in Word.

`soundings answers` takes the same `--format` options.

Run [`soundings verify`](verify.md) on a document you have edited by hand.
