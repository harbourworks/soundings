# Plans and licensing

## What is free

Scanning, the report, the questions flow and verifying any text are free, need no account and make **no network calls**. They work the same with or without a licence.

```
soundings scan .
soundings questions
soundings verify draft.md
```

## What needs Soundings Pro

The documents built from the evidence:

- `soundings answers`: the question bank answered as a document
- `soundings answer <file.csv>`: filling in a client's questionnaire
- the remaining documents and the Word and HTML exports, as they arrive

Running one without a plan stops with exit code 3 and says what is needed. It never degrades the free commands.

```
soundings buy               # the plans, and the checkout
soundings login <key>       # turn your licence on for this machine
soundings status            # your plan, and when it was last confirmed
soundings logout            # turn it off and free this machine's slot
```

Payment, tax, invoices and cancelling are handled by Polar, the merchant of record. After paying, your key is in the Polar customer portal under your plan. In CI, set the key as a secret called `SOUNDINGS_LICENCE` instead of running `login`.

## What the licence check sends

This is the only network call Soundings ever makes, and it happens only when a licence is in use. It goes to Polar's licence endpoints and sends:

- your licence key
- the name of your computer and its operating system (so you can recognise the machine in the customer portal)
- the activation ID Polar gave this machine

It never sends code, evidence, answers, file names or anything about your project. A saved check is trusted for 24 hours, so most commands make no call at all. If you are offline, a licence keeps working for 14 days after its last successful check; after that, paid commands pause until Soundings can check again. `--offline` makes no call and uses the saved check.

## Machines

A key can be active on a limited number of machines at once, set by your plan. `soundings logout` frees a slot, and so does removing the machine in the customer portal. In CI the key is validated without using up a slot.

## If your plan ends

When a subscription ends, Polar stops accepting the key and paid commands stop working on the next check. Everything you already produced is yours and stays usable, and the free commands are unaffected.
