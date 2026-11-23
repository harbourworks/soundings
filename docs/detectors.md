# Detectors

Each detector reads one family of facts and says where it stops. Detectors read the structure of your code (imports, calls, property names), so a package named in a comment, a string or a test file is not mistaken for a real use. Tests, specs and fixtures are left out of every code detector. Anything outside the supported list is reported as "couldn't determine", never guessed.

Supported: JavaScript, TypeScript and Python projects (Next.js, Node/Express, FastAPI, Flask, Django), Supabase, Firebase, Stripe, Azure, and the OpenAI, Anthropic, Google, Mistral, Cohere, Groq, AWS Bedrock and Vercel AI SDKs, Ollama's client libraries and the LiteLLM and OpenRouter routers.

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
| `ai-provider/ollama-sdk` | Imports of `ollama` (including `ollama/browser`); Python `ollama` or `langchain_ollama`. Reported as "Ollama" | Doesn't know where the Ollama server runs: the client can point at this machine or at another one, so the fact never says data stays local. It asks instead (`UQ-ollama-server-location`). The AI SDK community provider `ollama-ai-provider` is not read yet |
| `ai-provider/litellm` | Python imports of `litellm` | LiteLLM forwards requests to other vendors, chosen by model name and configuration, so it asks which ones (`UQ-litellm-routed-vendors`). Its proxy server, configured outside the code, is not read |
| `ai-provider/openrouter` | Imports of `@openrouter/sdk` or `@openrouter/ai-sdk-provider` | OpenRouter forwards requests to other vendors, so it asks which ones (`UQ-openrouter-routed-vendors`) |
| `ai-provider/vercel-ai-sdk` | Imports of `ai`; reported only when no named provider is used in the same file | Can't see which model provider is configured elsewhere |
| `data-flow/ai-request-payload` | Calls that send a prompt to a model, including OpenAI's structured-output and image calls (`responses.parse`, `chat.completions.parse`, `beta.chat.completions.parse`, `images.generate` and `images.edit`, read only as a method on an object such as `client.images.generate(…)`, so a bare `images.generate(…)` or `responses.parse(…)` is not) and Mistral's `chat.complete` and `chat.stream`. Google's `generateContent` and `generateContentStream` (`generate_content` and `generate_content_async` in Python) are also read when the prompt is passed on its own as the first argument rather than in an object, as in `model.generateContent(prompt)`, `` model.generateContent(`Summarise: ${note}`) `` or `model.generate_content(prompt)`, but only as a method on an object and only in files that import Google's own SDK (`@google/generative-ai` or `@google/genai`; `google.generativeai` or `google.genai` in Python): a bare `generateContent(prompt)`, or a `cms.generateContent(slug)` in a file that imports only another provider, is not read this way. Some shapes are read only in files that import the SDK, and only as a method on an object: Cohere's client `chat` and `chatStream` (`chat_stream` in Python); Ollama's `chat` and `generate` (`ollama.chat(…)` or a client's `client.generate(…)`, in JavaScript and Python); LiteLLM's `litellm.completion` and `litellm.acompletion`; OpenRouter's `chat.send`; and Bedrock's `new ConverseCommand(…)` and `new ConverseStreamCommand(…)` (JavaScript). The Vercel AI SDK's `generateText`, `streamText`, `generateObject`, `streamObject`, `embed` and `embedMany`, called as a bare name, and Bedrock's `new ConverseCommand(…)` or `new ConverseStreamCommand(…)` without a namespace, count only when the name is imported from that SDK's own module (`ai`; `@aws-sdk/client-bedrock-runtime` or `@ai-sdk/amazon-bedrock`), by `import { … }`, or by destructuring a `require(…)` or an `await import(…)` of it without renaming. An aliased named import is read as its imported name: `import { generateText as gt } from "ai"` makes `gt(…)` a model call, and `import { ConverseCommand as Conv } from "@aws-sdk/client-bedrock-runtime"` makes `new Conv(…)` one. A name defined in the file, imported from another module (`import { ConverseCommand } from "./commands"`) or not imported at all is not a model call, and neither is one re-bound by the code around the call (a parameter, a local `const`, `let` or `var`, a function, a class or a `catch` parameter). In Python, a bare `generate_text(…)`, `generate_content(…)` or `generate_content_async(…)` counts only when that name is imported from the SDK (`from google.generativeai import generate_text`) and the file doesn't define a function of the same name; called on an object or a module (`palm.generate_text(…)`) it is read as before. **High** when the prompt contains data from a request or a function parameter; **medium** when it is dynamic but its source isn't clear | A fixed prompt is not reported, and that includes `generateContent("ping")` and a template with nothing inserted. It can't tell what data a caller passes in. In JavaScript, a first argument that is a property or a function call (`generateContent(req.body.text)`, `generateContent(build(note))`) is not read as the prompt. Renamed destructuring of a `require` (`{ generateText: gt }`), or names re-exported from another file, are not followed. In Python, a name assigned at the top of the file after its import (`generate_text = …`) is not seen as re-bound. A bare `chat(…)` or `completion(…)` imported by name (`from litellm import completion`) is not read, and neither are LangChain's `ChatOllama` calls or Ollama and LiteLLM embedding calls. |

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
| `data-store/django` | Python settings that assign `DATABASES` at module level (with or without a type annotation): the `"ENGINE"` entries of that dict, when each is one plain string. Django's own backends are mapped: `postgresql` (and `postgresql_psycopg2`, and GeoDjango's `postgis`) to PostgreSQL, `sqlite3` (and `spatialite`) to SQLite, `mysql` to MySQL and `oracle` to Oracle, at **high** confidence, cited to the `ENGINE` line. Comments, docstrings and test settings are ignored. Test settings are any file the scan skips as test code (under a `test/`, `tests/`, `spec/`, `specs/`, `e2e/`, `fixtures/`, `__tests__/` or `__mocks__/` folder, or named `test_*.py`, `*_test.py` or `conftest.py`), plus a `test.py`, `tests.py` or `testing.py` in a `settings/` package or next to a `settings.py`; other settings modules (`base.py`, `local.py`, `production.py` and so on) are read. When no engine can be read (`env.db()`, `dj_database_url.config()`, a variable, an f-string or a backend outside Django) but the project imports `django.db.models` or has an `<app>/migrations/0001_*.py` migration that imports `django.db`, it reports "SQL database (Django)" at **medium** confidence and says it couldn't tell the engine; that is dropped once a specific SQL engine is found | The fact says only that the settings name the engine, not that user data is stored in it. Each settings module's own `DATABASES` is read separately: `from .base import *` and later `DATABASES["default"]["ENGINE"] = …` assignments aren't followed. Doesn't read `dict(ENGINE=…)` calls or name third-party backends. Doesn't read models, fields or migrations beyond their presence. Doesn't know the host |

When Prisma, Drizzle or Django settings name the same engine as a client import (Prisma on PostgreSQL alongside `pg`, say), it is one database, so the report shows one fact. The client import's fact stays and also lists the ORM's locations.

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

Where the code can't answer, the scan asks. A question appears only when a fact makes it relevant, and its ID (`UQ-…`) comes from its subject, so it stays the same between scans: data use at each AI provider, where an Ollama server runs, which vendors LiteLLM or OpenRouter route to, the hosting region or location of each data store, how long data is kept and deleted, and where a site with no back end is hosted.
