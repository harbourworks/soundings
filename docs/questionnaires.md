# Filling in a client's questionnaire

```
soundings answer client-questionnaire.csv
```

Soundings reads the questionnaire, matches each row to a question in its [bank](questions.md), and writes a copy with the answers filled in. The original is never overwritten.

Excel files aren't supported yet: in Excel use **File, Save As, CSV UTF-8**, then run the command on the CSV.

## What it does to each row

- It finds the question column (a header such as "Question" or "Requirement", or failing that the column with the most text) and the answer column (a header such as "Answer" or "Response"). If there is no answer column it adds one called "Soundings answer".
- A row that clearly matches a bank question gets that question's answer, with its `[EV-…]` and `[A-…]` markers. If the answer is only partly known, the rest says `NEEDS YOUR INPUT:` followed by what is missing.
- A row that doesn't clearly match gets `NEEDS YOUR INPUT: no standard question clearly matches this one`, and is listed in the summary. **It is never guessed.**
- A cell the client already filled in is left alone.
- Two columns are added: **Soundings sources** (what each marker points to) and **Soundings match** (which bank question the row was matched to, so you can check it).

## How well does it match?

Matching compares the wording of each row with the bank's questions and keywords, and accepts a match only if it is clearly the best one. It would rather leave a row for you than answer the wrong question.

Measured on the questionnaires in this repository:

- On a 29-row sample it was tuned against, every row matched correctly, and the three commercial questions (turnover, sustainability policy, VAT number) were left unmatched.
- On 25 rows written afterwards in different words, it made **no wrong matches**, left every commercial question unmatched, and matched 7 of the 18 security questions it should have. The rest were left for a person.

So expect to answer a good share of rows by hand until the bank has seen more real questionnaires. A low match rate costs time; the design means it should not cost correctness. Check the "Soundings match" column before you send anything.

Run `soundings verify` on the finished file's answers if you edit them by hand.
