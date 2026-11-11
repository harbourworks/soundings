# Detectors

Each detector reads one family of facts and says where it stops. Detectors read the structure of your code (imports, calls, property names), so a package named in a comment, a string or a test file is not mistaken for a real use. Tests, specs and fixtures are left out of every code detector. Anything outside the supported list is reported as "couldn't determine", never guessed.

Supported: JavaScript and TypeScript projects (Next.js, Node/Express), Supabase, Firebase, Stripe, and the OpenAI, Anthropic, Google and Vercel AI SDKs.

Every detector ID below appears in the `scan` block of the evidence file when it ran, or in `detectorsSkipped` with the reason it didn't.

## AI providers

| Detector | Reads | Stops at |
| --- | --- | --- |
| `ai-provider/openai-sdk` | Imports of `openai` or `@ai-sdk/openai`; the model name if it is a string in the file | Doesn't know which account or plan is used |
| `ai-provider/anthropic-sdk` | Imports of `@anthropic-ai/sdk` or `@ai-sdk/anthropic` | Same |
| `ai-provider/google-sdk` | Imports of `@google/generative-ai`, `@google/genai` or `@ai-sdk/google` | Same |
| `ai-provider/vercel-ai-sdk` | Imports of `ai`; reported only when no named provider is used in the same file | Can't see which model provider is configured elsewhere |
| `data-flow/ai-request-payload` | Calls that send a prompt to a model. **High** when the prompt contains data from a request or a function parameter; **medium** when it is dynamic but its source isn't clear | A fixed prompt is not reported. It can't tell what data a caller passes in |

## Third-party services

One detector per service, named `third-party/<service>`: `stripe`, `vercel-analytics`, `plausible-analytics`, `google-analytics`, `hotjar`, `posthog`, `mixpanel`, `segment`, `sentry`, `resend`, `sendgrid`, `postmark`, `twilio`.

They read imports of the service's packages and, for analytics, `<script src>` tags in HTML and script URLs in code. A link to a service's website, or a mention in prose, is not a use.

## How users sign in

| Detector | Reads | Stops at |
| --- | --- | --- |
| `auth/supabase-auth` | Supabase `auth.signIn…` and `auth.signUp` calls, and which methods they use | Doesn't see dashboard settings such as enabled providers or MFA |
| `auth/jwt` | Imports of `jsonwebtoken` or `jose` | Doesn't judge how tokens are issued or expire |
| `auth/authjs`, `auth/clerk`, `auth/auth0`, `auth/firebase-auth`, `auth/passport` | Imports of each library | Same |

## Where data is stored

| Detector | Reads | Stops at |
| --- | --- | --- |
| `data-store/supabase` | `supabase/migrations/*.sql` and `supabase/schema.sql` for tables created and row-level security enabled (comments and Supabase's own schemas are ignored); falls back to the client library at **medium** confidence when there are no migrations | Doesn't know the region, or policies added outside the repo |
| `data-store/postgres`, `data-store/mongodb`, `data-store/redis`, `data-store/firebase` | Imports of the usual client libraries | Doesn't know where the database is hosted |

## Keys and secrets

| Detector | Reads | Stops at |
| --- | --- | --- |
| `secrets/env-usage` | `process.env.X` reads for secret-named variables (key, secret, token, password, DSN, database URL). Records names only | Public-prefixed variables (`NEXT_PUBLIC_…`) are not secrets and are skipped. It can't see how the environment is populated |
| `secrets/hardcoded-patterns` | Every text file for values shaped like known credentials. Records the kind and the file, never the value | **Finding nothing is reported as "not found", at medium confidence.** A pattern search can rule out only the formats it knows |

## Logging

| Detector | Reads | Stops at |
| --- | --- | --- |
| `logging/request-body` | Log calls (`console.*`, `logger.*`) that include a request body, directly or through a variable | Reported at medium confidence. It can't see log levels, destinations or retention |

## Reachable from the browser

| Detector | Reads | Stops at |
| --- | --- | --- |
| `client-exposure/public-secret-name` | Secret-named variables with a public prefix (`NEXT_PUBLIC_OPENAI_API_KEY`). Supabase anon and publishable keys are public by design and are not reported | Judges by name |
| `client-exposure/ai-sdk-in-browser` | An AI SDK imported in a `"use client"` file | Medium confidence: it suggests a key may reach the browser |

## Questions the scan raises

Where the code can't answer, the scan asks. A question appears only when a fact makes it relevant, and its ID (`UQ-…`) comes from its subject, so it stays the same between scans: data use at each AI provider, the hosting region or location of each data store, how long data is kept and deleted, and where a site with no back end is hosted.
