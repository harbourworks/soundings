# Detectors

Each detector reads one family of facts and says where it stops. Detectors read the structure of your code (imports, calls, property names), so a package named in a comment, a string or a test file is not mistaken for a real use. Tests, specs and fixtures are left out of every code detector. Anything outside the supported list is reported as "couldn't determine", never guessed.

Supported: JavaScript, TypeScript and Python projects (Next.js, Node/Express, FastAPI, Flask, Django), Supabase, Firebase, Stripe, Azure, and the OpenAI, Anthropic, Google, Mistral, Cohere, Groq, AWS Bedrock and Vercel AI SDKs.

Every detector ID below appears in the `scan` block of the evidence file when it ran, or in `detectorsSkipped` with the reason it didn't.

## AI providers

| Detector | Reads | Stops at |
| --- | --- | --- |
| `ai-provider/openai-sdk` | Imports of `openai` or `@ai-sdk/openai`; the model name if it is a string in the file | Doesn't know which account or plan is used |
| `ai-provider/anthropic-sdk` | Imports of `@anthropic-ai/sdk` or `@ai-sdk/anthropic` | Same |
| `ai-provider/google-sdk` | Imports of `@google/generative-ai`, `@google/genai` or `@ai-sdk/google` | Same |
| `ai-provider/mistral-sdk` | Imports of `@mistralai/mistralai` or `@ai-sdk/mistral`; Python `mistralai` or `langchain_mistralai` | Same |
| `ai-provider/cohere-sdk` | Imports of `cohere-ai` or `@ai-sdk/cohere`; Python `cohere` or `langchain_cohere` | Same |
| `ai-provider/groq-sdk` | Imports of `groq-sdk` or `@ai-sdk/groq`; Python `groq` | Same |
| `ai-provider/bedrock-sdk` | Imports of `@aws-sdk/client-bedrock-runtime` or `@ai-sdk/amazon-bedrock`; Python `langchain_aws` | Doesn't know which account, region or model vendor on Bedrock is used. A `boto3` Bedrock client is not read yet |
| `ai-provider/vercel-ai-sdk` | Imports of `ai`; reported only when no named provider is used in the same file | Can't see which model provider is configured elsewhere |
| `data-flow/ai-request-payload` | Calls that send a prompt to a model, including Mistral's `chat.complete` and `chat.stream`. Two shapes are read only in files that import the SDK: Cohere's client `chat` and `chatStream` (`chat_stream` in Python), and Bedrock's `new ConverseCommand(…)` and `new ConverseStreamCommand(…)` (JavaScript). **High** when the prompt contains data from a request or a function parameter; **medium** when it is dynamic but its source isn't clear | A fixed prompt is not reported. It can't tell what data a caller passes in |

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
| `data-store/prisma` | Imports of `@prisma/client` in product code, and the `provider` of the `datasource` block in any `.prisma` schema file (`//` comments are ignored; the `url` is never read). Reports PostgreSQL, MySQL, SQLite, MongoDB, SQL Server or CockroachDB. With no readable schema it reports "SQL database (Prisma)" at **medium** confidence, dropped once a specific SQL engine is found | Doesn't know the host. Doesn't follow a client generated to a custom output path |
| `data-store/drizzle` | Imports of `drizzle-orm`. The schema module names the engine: `drizzle-orm/pg-core` is PostgreSQL, `mysql-core` MySQL, `sqlite-core` SQLite. Otherwise it reports "SQL database (Drizzle)", dropped once a specific SQL engine is found | Doesn't read the engine from driver imports such as `drizzle-orm/neon-http`. Doesn't know the host |

When Prisma or Drizzle names the same engine as a client import (Prisma on PostgreSQL alongside `pg`, say), it is one database, so the report shows one fact. The client import's fact stays and also lists the ORM's locations.

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

## Python

Python is read with a small built-in tokenizer, not a parser dependency. Comments and strings (including docstrings) are never mistaken for code, so a library named in a comment, a docstring or a test file is not a use. The detectors that read JavaScript also read Python imports and calls and report the same facts (`ai-provider/*`, `data-flow/ai-request-payload`, `third-party/*`, `secrets/env-usage`, `logging/request-body`). For Python they also read `os.environ`, `os.getenv` and pydantic `BaseSettings` fields for secret names, and treat route-handler parameters (`@router.post`) as request content when tracing what reaches a prompt or a log. Virtual environments and tool caches are skipped.

Detectors added for Python and the Azure stack:

| Detector | Reads | Stops at |
| --- | --- | --- |
| `auth/entra` | MSAL imports (Python and JavaScript) | Doesn't see tenant or conditional-access settings |
| `auth/fastapi-security`, `auth/django-auth`, `auth/flask-login`, `auth/authlib` | Imports of the framework's authentication helpers | Doesn't judge how they are configured |
| `data-store/mysql`, `data-store/sqlalchemy`, `data-store/cosmos` | Client imports. SQLAlchemy is dropped when a specific SQL engine is found | Doesn't know the host |
| `data-store/azure-blob`, `data-store/azure-search` | Azure storage and search client imports | Doesn't know the region or account settings |
| `data-store/chroma`, `data-store/qdrant`, `data-store/pinecone` | Vector database client imports | Same |
| `data-store/connection-string` | Database URLs in configuration files (compose, settings, env templates), at **medium** confidence. Dropped when a client import already shows the same store | A URL in config shows what the project is set up to use, not that it runs |

## Code the scan can't read

Soundings reads JavaScript, TypeScript and Python. Source files in Go, Java, Kotlin, Ruby, PHP, C#, Rust, Swift, Scala, Elixir and Dart are counted but never analysed (test folders are left out of the count), and the report says so at the top.

- Below three such files they are noted and the scan carries on.
- From three files up, the scan can't describe the project, so it **does not claim that anything was "not found"** (no AI provider, database, sign-in method or request-body logging). It asks instead: `UQ-unanalysed-code` asks what the unread code does, and your answer is used, attributed to you, wherever the questions and documents would otherwise have said "not found".
- Facts about the JavaScript and TypeScript it did read are reported as usual. The secret-pattern search reads every text file whatever its language, so its result stands.

The same finding in several files is reported once, with its locations, not once per file.

## Questions the scan raises

Where the code can't answer, the scan asks. A question appears only when a fact makes it relevant, and its ID (`UQ-…`) comes from its subject, so it stays the same between scans: data use at each AI provider, the hosting region or location of each data store, how long data is kept and deleted, and where a site with no back end is hosted.
