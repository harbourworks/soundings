import { describe, expect, it } from "vitest";
import { tokenizePython } from "../src/scanner/python/tokenize.js";
import { callsOf, functionsOf, importsOf } from "../src/scanner/python/parse.js";
import { cleanupProjects, evidenceOf, factsOf } from "./helpers.js";

cleanupProjects();

describe("python tokenizer", () => {
  it("never treats comments or docstrings as code", () => {
    const lines = tokenizePython('"""import openai"""\n# import anthropic\nimport os  # import stripe\nx = "import redis"\n');
    expect(importsOf(lines).map((i) => i.module)).toEqual(["os"]);
  });

  it("reads from-imports, aliases and parenthesised lists, and skips relative imports", () => {
    const lines = tokenizePython("from google import genai\nimport a.b as c, d\nfrom x import (\n    p,\n    q as r,\n)\nfrom . import local\n");
    expect(importsOf(lines)).toEqual([
      { module: "google", names: ["genai"], line: 1 },
      { module: "a.b", names: [], line: 2 },
      { module: "d", names: [], line: 2 },
      { module: "x", names: ["p", "q"], line: 3 },
    ]);
  });

  it("reads function parameters and route decorators", () => {
    const f = functionsOf(tokenizePython('@router.post("/ask")\nasync def ask(payload: dict, request: Request, *, n: int = 1):\n    pass\n'));
    expect(f).toEqual([{ name: "ask", params: ["payload", "request", "n"], decorators: ['router.post("/ask")'], line: 2 }]);
  });

  it("finds nested calls with their dotted names", () => {
    const calls = callsOf(tokenizePython("client.chat.completions.create(model=pick(x))\n"));
    expect(calls.map((c) => c.chain.join("."))).toEqual(["client.chat.completions.create", "pick"]);
  });

  it("survives broken input", () => {
    expect(() => tokenizePython("def (((\n\"unterminated\n'''never closed")).not.toThrow();
  });
});

describe("python detectors", () => {
  const req = "openai==1.0.0\n";

  it("flags an SDK import, and ignores comments, docstrings and test files", () => {
    expect(factsOf({ "requirements.txt": req, "app/a.py": "from openai import OpenAI\nc = OpenAI()\n" })).toContain("ai_provider|OpenAI|ai-provider/openai-sdk");
    const decoys = { "requirements.txt": req, "app/a.py": '"""import openai"""\n# import openai\n', "tests/test_a.py": "import openai\n", "app/test_b.py": "import openai\n" };
    expect(factsOf(decoys).filter((f) => f.startsWith("ai_provider"))).toEqual([]);
  });

  it("traces a prompt built from a function parameter (high), from an unknown source (medium), and ignores a fixed one", () => {
    const head = "from openai import OpenAI\nclient = OpenAI()\n";
    const high = evidenceOf({ "a.py": `${head}def ask(q):\n    return client.chat.completions.create(model='m', messages=[{'role': 'user', 'content': f'Q: {q}'}])\n` });
    expect(high.facts.find((f) => f.kind === "data_flow")?.confidence).toBe("high");
    const medium = evidenceOf({ "a.py": `${head}text = load()\nr = client.chat.completions.create(model='m', messages=[{'role': 'user', 'content': text}])\n` });
    expect(medium.facts.find((f) => f.kind === "data_flow")?.confidence).toBe("medium");
    const fixed = evidenceOf({ "a.py": `${head}r = client.chat.completions.create(model='m', messages=[{'role': 'user', 'content': 'Say hello.'}])\n` });
    expect(fixed.facts.some((f) => f.kind === "data_flow")).toBe(false);
  });

  it.each([
    ["mistralai==1.2.0\n", "from mistralai import Mistral\nc = Mistral()\n", "Mistral", "ai-provider/mistral-sdk", "mistralai"],
    ["langchain-mistralai==0.2.0\n", "from langchain_mistralai import ChatMistralAI\nc = ChatMistralAI()\n", "Mistral", "ai-provider/mistral-sdk", "langchain_mistralai"],
    ["cohere==5.0.0\n", "import cohere\nco = cohere.ClientV2()\n", "Cohere", "ai-provider/cohere-sdk", "cohere"],
    ["langchain-cohere==0.3.0\n", "from langchain_cohere import ChatCohere\nc = ChatCohere()\n", "Cohere", "ai-provider/cohere-sdk", "langchain_cohere"],
    ["groq==0.11.0\n", "from groq import Groq\nc = Groq()\n", "Groq", "ai-provider/groq-sdk", "groq"],
    ["langchain-aws==0.2.0\n", "from langchain_aws import ChatBedrock\nc = ChatBedrock(model_id='m')\n", "AWS Bedrock", "ai-provider/bedrock-sdk", "langchain_aws"],
    ["ollama==0.4.0\n", "import ollama\nc = ollama.Client()\n", "Ollama", "ai-provider/ollama-sdk", "ollama"],
    ["langchain-ollama==0.2.0\n", "from langchain_ollama import ChatOllama\nc = ChatOllama(model='llama3')\n", "Ollama", "ai-provider/ollama-sdk", "langchain_ollama"],
    ["litellm==1.50.0\n", "import litellm\nc = litellm\n", "LiteLLM", "ai-provider/litellm", "litellm"],
    ["litellm==1.50.0\n", "from litellm import completion\nc = completion\n", "LiteLLM", "ai-provider/litellm", "litellm"],
  ])("flags an import (%#) at its line", (req, code, subject, id, sdk) => {
    const e = evidenceOf({ "requirements.txt": req, "app/a.py": `# set up the client\n${code}` });
    const f = e.facts.find((x) => x.detector === id);
    expect(f?.subject).toBe(subject);
    expect(f?.locations).toEqual([{ file: "app/a.py", line: 2 }]);
    expect(f?.attributes.sdk).toBe(sdk);
  });

  it("ignores the new providers in comments, docstrings, strings and test files", () => {
    const decoys = {
      "requirements.txt": "groq==0.11.0\nmistralai==1.2.0\ncohere==5.0.0\nlangchain-aws==0.2.0\n",
      "app/a.py": '"""import groq"""\n# from mistralai import Mistral\nNAMES = ["groq", "mistralai", "cohere", "langchain_aws"]\n',
      "tests/test_a.py": "import groq\nimport cohere\n",
      "app/test_b.py": "from mistralai import Mistral\nfrom langchain_aws import ChatBedrock\n",
    };
    expect(factsOf(decoys).filter((f) => f.startsWith("ai_provider") || f.startsWith("data_flow"))).toEqual([]);
  });

  it("traces request text into Mistral, Cohere and Groq calls", () => {
    const flow = (code: string) => evidenceOf({ "a.py": code }).facts.filter((f) => f.kind === "data_flow").map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`);
    const mistral = "from mistralai import Mistral\nclient = Mistral()\ndef ask(q):\n    return client.chat.complete(model='m', messages=[{'role': 'user', 'content': q}])\n";
    expect(flow(mistral)).toEqual(["Mistral|high|4"]);
    expect(flow(mistral.replace("chat.complete(", "chat.stream("))).toEqual(["Mistral|high|4"]);
    expect(flow(mistral.replace("return client.chat.complete(", "return await client.chat.complete_async(").replace("def ask", "async def ask"))).toEqual(["Mistral|high|4"]);
    const cohere = "import cohere\nco = cohere.ClientV2()\ndef ask(q):\n    return co.chat(model='command-r', messages=[{'role': 'user', 'content': q}])\n";
    expect(flow(cohere)).toEqual(["Cohere|high|4"]);
    expect(flow(cohere.replace("import cohere\nco = cohere.", "import cohere as c\nco = c.").replace("co.chat(", "co.chat_stream("))).toEqual(["Cohere|high|4"]);
    const groq = "from groq import Groq\nclient = Groq()\ndef ask(q):\n    return client.chat.completions.create(model='m', messages=[{'role': 'user', 'content': q}])\n";
    expect(flow(groq)).toEqual(["Groq|high|4"]);
    expect(flow(mistral.replace("'content': q", "'content': 'Say hello.'"))).toEqual([]);
  });

  it("traces a prompt passed positionally to Gemini's generate_content, and ignores a fixed one", () => {
    const flow = (code: string) => evidenceOf({ "app/a.py": code }).facts.filter((f) => f.kind === "data_flow").map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`);
    const head = 'import google.generativeai as genai\n\nmodel = genai.GenerativeModel("gemini-2.5-flash")\n\n\n';
    const ask = (call: string, before = "") => flow(`${head}${before}def summarise(prompt: str) -> str:\n    result = ${call}\n    return result.text\n`);
    expect(ask("model.generate_content(prompt)")).toEqual(["Google AI|high|7"]);
    expect(ask('model.generate_content(f"Summarise: {prompt}")')).toEqual(["Google AI|high|7"]);
    expect(ask('model.generate_content(["Describe this image.", prompt], stream=True)')).toEqual(["Google AI|high|7"]);
    expect(ask("await model.generate_content_async(prompt)").map((s) => s.replace(/\|\d+$/, ""))).toEqual(["Google AI|high"]);
    expect(ask("model.generate_content(STYLE_GUIDE)", "from .prompts import STYLE_GUIDE\n")).toEqual(["Google AI|medium|8"]);
    // Decoys: fixed text, an f-string with nothing in it, and a bare local helper of the same name.
    expect(ask('model.generate_content("ping")')).toEqual([]);
    expect(ask("model.generate_content('Say ' 'hello.', stream=True)")).toEqual([]);
    expect(ask('model.generate_content(f"ping")')).toEqual([]);
    expect(ask("generate_content(prompt)", "def generate_content(x):\n    return x\n\n\n")).toEqual([]);
    expect(ask("generate_content(contents=prompt)", "def generate_content(contents):\n    return contents\n\n\n")).toEqual([]);
    // Unpacked arguments aren't the prompt itself, so they aren't read as one.
    expect(flow(`${head}def ask(*parts, **options):\n    return model.generate_content(**options)\n`)).toEqual([]);
    expect(flow(`${head}def ask(*parts, **options):\n    return model.generate_content(*parts)\n`)).toEqual([]);
    // Keyword forms are read as before.
    expect(ask('model.generate_content(contents=prompt)')).toEqual(["Google AI|high|7"]);
    expect(ask('model.generate_content(contents="ping")')).toEqual([]);
  });

  it("reads a bare generate_text or generate_content only when it is imported from the SDK and not defined in the file (#42)", () => {
    const flow = (code: string) => evidenceOf({ "app/main.py": code }).facts.filter((f) => f.kind === "data_flow").map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`);
    // A local helper of the SDK's name, in a file that imports another provider.
    const local = "from openai import OpenAI\nclient = OpenAI()\n\ndef generate_text(prompt):\n    return prompt.upper()\n\ndef handle(question):\n    return generate_text(prompt=question)\n";
    expect(flow(local)).toEqual([]);
    // Imported by name from a project module, or not imported at all.
    expect(flow("import openai\nfrom .helpers import generate_text\n\ndef handle(question):\n    return generate_text(prompt=question)\n")).toEqual([]);
    expect(flow("import google.generativeai as genai\n\ndef handle(question):\n    return generate_content(contents=question)\n")).toEqual([]);
    // Imported from the SDK's own module under another name: the bare name is not the SDK's.
    expect(flow("from google.generativeai import configure as generate_text\n\ndef handle(question):\n    return generate_text(prompt=question)\n")).toEqual([]);
    // Imported from Google's SDK by name, or called on the module: still read.
    expect(flow("from google.generativeai import generate_text\n\ndef handle(question):\n    return generate_text(prompt=question)\n")).toEqual(["Google AI|high|4"]);
    expect(flow("import google.generativeai as palm\n\ndef handle(question):\n    return palm.generate_text(prompt=question)\n")).toEqual(["Google AI|high|4"]);
  });

  it("reads generate_content positionally only in files that import Google's SDK (near-miss)", () => {
    const flow = (code: string) => evidenceOf({ "main.py": code }).facts.filter((f) => f.kind === "data_flow").map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`);
    const seo = 'from openai import OpenAI\n\nclient = OpenAI()\n\n\ndef tagline():\n    r = client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": "Write a tagline."}])\n    return r.choices[0].message.content\n\n\ndef page(slug):\n    return pages.generate_content(slug)\n';
    expect(flow(seo)).toEqual([]);
    expect(flow(seo.replace("pages.generate_content(slug)", 'await pages.generate_content_async(f"Page: {slug}")'))).toEqual([]);
    // LangChain's Google wrapper is not Google's own SDK, so it does not turn the read on.
    expect(flow(seo.replace("from openai import OpenAI", "from openai import OpenAI\nfrom langchain_google_genai import ChatGoogleGenerativeAI"))).toEqual([]);
    // Either Google SDK, in either import form, does.
    const gemini = "\n\ndef page(slug):\n    return model.generate_content(slug)\n";
    expect(flow(`from google import generativeai as genai${gemini}`)).toEqual(["Google AI|high|4"]);
    expect(flow(`import google.genai${gemini}`)).toEqual(["Google AI|high|4"]);
  });

  it("traces request text into Ollama and LiteLLM calls", () => {
    const flow = (code: string) => evidenceOf({ "a.py": code }).facts.filter((f) => f.kind === "data_flow").map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`);
    const chat = "import ollama\n\ndef ask(q):\n    return ollama.chat(model='llama3', messages=[{'role': 'user', 'content': q}])\n";
    expect(flow(chat)).toEqual(["Ollama|high|4"]);
    expect(flow(chat.replace("ollama.chat(model='llama3', messages=[{'role': 'user', 'content': q}])", "ollama.generate(model='llama3', prompt=f'Summarise: {q}')"))).toEqual(["Ollama|high|4"]);
    const client = "from ollama import Client\nclient = Client(host='http://10.0.0.5:11434')\ndef ask(q):\n    return client.chat(model='m', messages=[{'role': 'user', 'content': q}])\n";
    expect(flow(client)).toEqual(["Ollama|high|4"]);
    const litellm = "import litellm\n\ndef ask(q):\n    return litellm.completion(model='gpt-4o', messages=[{'role': 'user', 'content': q}])\n";
    expect(flow(litellm)).toEqual(["LiteLLM|high|4"]);
    expect(flow(litellm.replace("return litellm.completion(", "return await litellm.acompletion(").replace("def ask", "async def ask"))).toEqual(["LiteLLM|high|4"]);
    expect(flow(chat.replace("'content': q", "'content': 'Say hello.'"))).toEqual([]);
  });

  it("says LiteLLM and Ollama facts honestly, and asks what the code can't show", () => {
    const e = evidenceOf({ "a.py": "import litellm\nimport ollama\nx = [litellm, ollama]\n" });
    expect(e.facts.find((f) => f.subject === "LiteLLM")?.claim).toBe(
      "The app uses the LiteLLM SDK from server code. LiteLLM sends requests on to model vendors chosen by model name and configuration, which the scan doesn't identify.",
    );
    expect(e.facts.find((f) => f.subject === "Ollama")?.claim).toBe(
      "The app uses the Ollama client library from server code. The scan doesn't read where the Ollama server it talks to runs: it can be this machine or another one.",
    );
    expect(e.unknowns.map((u) => u.id)).toEqual(["UQ-litellm-data-use", "UQ-litellm-routed-vendors", "UQ-ollama-data-use", "UQ-ollama-server-location"]);
  });

  it("ignores Ollama and LiteLLM in comments, docstrings, strings and test files", () => {
    const decoys = {
      "requirements.txt": "ollama==0.4.0\nlitellm==1.50.0\n",
      "app/a.py": '"""import ollama"""\n# import litellm\nNAMES = ["ollama", "litellm", "langchain_ollama"]\nNOTE = "litellm.completion(messages=m)"\n',
      "tests/test_a.py": "import ollama\nimport litellm\n",
      "app/test_b.py": "from langchain_ollama import ChatOllama\n",
    };
    expect(factsOf(decoys).filter((f) => f.startsWith("ai_provider") || f.startsWith("data_flow"))).toEqual([]);
  });

  it("reads a bare completion or generate call as LiteLLM's or Ollama's only in a file that imports them", () => {
    const flow = (code: string) => evidenceOf({ "a.py": code }).facts.filter((f) => f.kind === "data_flow");
    expect(flow("from openai import OpenAI\nbot = OpenAI()\ndef ask(q):\n    return [bot.completion(messages=[{'role': 'user', 'content': q}]), bot.generate(prompt=q)]\n")).toEqual([]);
  });

  it("reads a bare chat call as Cohere's only in a file that imports Cohere", () => {
    const flow = (code: string) => evidenceOf({ "a.py": code }).facts.filter((f) => f.kind === "data_flow");
    expect(flow("from openai import OpenAI\nbot = OpenAI()\ndef ask(q):\n    return bot.chat(messages=[{'role': 'user', 'content': q}])\n")).toEqual([]);
    expect(flow("import cohere\nco = cohere.ClientV2()\ndef chat(**kw):\n    return kw\ndef ask(q):\n    return chat(messages=[{'role': 'user', 'content': q}])\n")).toEqual([]);
  });

  it("reads secret-named environment variables and pydantic settings, by name only", () => {
    const e = evidenceOf({
      "a.py": "import os\nk = os.environ['STRIPE_SECRET_KEY']\nd = os.getenv('DATABASE_URL')\nn = os.getenv('PORT')\n",
      "s.py": "class S(BaseSettings):\n    jwt_secret: str\n    debug: bool = False\n",
    });
    expect(e.facts.find((f) => f.detector === "secrets/env-usage")?.attributes.keyNames).toEqual(["DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY"]);
  });

  it("flags a logged request body and ignores logs that don't include one", () => {
    const logs = (body: string) => factsOf({ "a.py": `import logging\nlogger = logging.getLogger()\n${body}` }).includes("logging|Server logs|logging/request-body");
    expect(logs("@app.post('/x')\nasync def x(payload: dict):\n    logger.info('got %s', payload)\n")).toBe(true);
    expect(logs("async def h(request):\n    logger.info(await request.json())\n")).toBe(true);
    expect(logs("@app.get('/x')\nasync def x():\n    logger.info('started')\n")).toBe(false);
  });

  it("does not scan virtual environments", () => {
    const e = evidenceOf({ "app/a.py": "x = 1\n", ".venv/lib/site-packages/openai/__init__.py": "import openai\n", "venv/x.py": "import stripe\n" });
    expect(e.facts.some((f) => f.subject === "OpenAI" || f.subject === "Stripe")).toBe(false);
  });

  it("reports a connection string only when no import already shows the store", () => {
    const only = evidenceOf({ "docker-compose.yml": "x: postgresql://app:${PW}@db/app\n" });
    expect(only.facts.find((f) => f.detector === "data-store/connection-string")?.confidence).toBe("medium");
    const both = evidenceOf({ "docker-compose.yml": "x: postgresql://app:${PW}@db/app\n", "a.py": "import asyncpg\n" });
    expect(both.facts.filter((f) => f.subject === "PostgreSQL").map((f) => f.detector)).toEqual(["data-store/postgres"]);
  });
});

describe("django databases", () => {
  const settings = (engine: string, extra = "") => `import os\n\n${extra}DATABASES = {\n    "default": {\n        "ENGINE": ${engine},\n        "NAME": "app",\n    }\n}\n`;
  const models = "from django.db import models\n\n\nclass Note(models.Model):\n    body = models.TextField()\n";
  const migration = "from django.db import migrations, models\n\n\nclass Migration(migrations.Migration):\n    operations = [migrations.CreateModel(name='Note', fields=[])]\n";
  const stores = (files: Record<string, string>) => evidenceOf(files).facts.filter((f) => f.kind === "data_store");

  it.each([
    ['"django.db.backends.postgresql"', "PostgreSQL", "postgresql"],
    ["'django.db.backends.postgresql_psycopg2'", "PostgreSQL", "postgresql"],
    ['"django.db.backends.sqlite3"', "SQLite", "sqlite"],
    ['"django.db.backends.mysql"', "MySQL", "mysql"],
    ['"django.db.backends.oracle"', "Oracle", "oracle"],
  ])("reads ENGINE %s as %s, at the ENGINE line", (engine, subject, attr) => {
    const [f, ...rest] = stores({ "site/settings.py": settings(engine) });
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ subject, detector: "data-store/django", confidence: "high", claimType: "observed", attributes: { engine: attr } });
    expect(f!.claim).toBe(`The project's Django settings name ${subject} as a database engine (DATABASES ENGINE).`);
    expect(f!.locations).toEqual([{ file: "site/settings.py", line: 5 }]);
  });

  it("reads annotated, single-line, single-quoted and CRLF settings", () => {
    const subject = (code: string) => stores({ "site/settings.py": code }).map((f) => `${f.subject}|${f.locations?.[0]?.line}`);
    expect(subject('from typing import Any\nDATABASES: dict[str, Any] = {"default": {"ENGINE": "django.db.backends.mysql"}}\n')).toEqual(["MySQL|2"]);
    expect(subject("DATABASES={'default':{'ENGINE':'django.db.backends.sqlite3','NAME':'db'}}\n")).toEqual(["SQLite|1"]);
    expect(subject("DATABASES = {\r\n    'default': {\r\n        'ENGINE': 'django.contrib.gis.db.backends.postgis',\r\n    }\r\n}\r\n")).toEqual(["PostgreSQL|3"]);
    expect(subject('DATABASES == {"default": {"ENGINE": "django.db.backends.mysql"}}\n')).toEqual(["No database found|undefined"]);
  });

  it("reports a backend outside Django as one it can't tell, not as a guess", () => {
    const s = stores({ "site/settings.py": settings('"mssql"'), "notes/models.py": models });
    expect(s.map((f) => `${f.subject}|${f.confidence}`)).toEqual(["SQL database (Django)|medium"]);
  });

  it("asks where the database is hosted and how long data is kept", () => {
    const ids = evidenceOf({ "site/settings.py": settings('"django.db.backends.postgresql"') }).unknowns.map((u) => u.id);
    expect(ids).toEqual(["UQ-postgresql-hosting", "UQ-retention-deletion"]);
  });

  it.each([
    ["env.db()", "import environ\nenv = environ.Env()\nDATABASES = {\"default\": env.db()}\n"],
    ["dj_database_url.config()", "import dj_database_url\nDATABASES = {\"default\": dj_database_url.config(conn_max_age=600)}\n"],
    ["a variable", settings("DB_ENGINE", 'DB_ENGINE = os.environ["DB_ENGINE"]\n')],
    ["an environment default", settings('os.environ.get("DB_ENGINE", "django.db.backends.sqlite3")')],
    ["an f-string", settings('f"django.db.backends.{kind}"', 'kind = "mysql"\n')],
  ])("reports an engine it can't read (%s) as a medium SQL database, never none-found", (_, code) => {
    const e = evidenceOf({ "site/settings.py": code, "notes/models.py": models });
    const s = e.facts.filter((f) => f.kind === "data_store");
    expect(s.map((f) => `${f.subject}|${f.confidence}|${f.detector}`)).toEqual(["SQL database (Django)|medium|data-store/django"]);
    expect(s[0]!.claim).toBe("The project uses Django's database layer (models or migrations), but the scan could not tell which database engine its settings name.");
    expect(s[0]!.locations?.map((l) => l.file).sort()).toEqual(["notes/models.py", "site/settings.py"]);
    expect(e.unknowns.map((u) => u.id).sort()).toEqual(["UQ-retention-deletion", "UQ-sql-database-hosting"]);
  });

  it("never says none-found when the project has Django models or migrations, even without settings", () => {
    expect(stores({ "notes/models.py": models }).map((f) => `${f.subject}|${f.confidence}`)).toEqual(["SQL database (Django)|medium"]);
    const m = stores({ "notes/migrations/__init__.py": "", "notes/migrations/0001_initial.py": migration });
    expect(m.map((f) => `${f.subject}|${f.confidence}`)).toEqual(["SQL database (Django)|medium"]);
    expect(m[0]!.locations).toEqual([{ file: "notes/migrations/0001_initial.py", line: 1 }]);
  });

  it("ignores ENGINE in comments, docstrings, test settings, other dicts and functions", () => {
    const decoys = {
      "site/settings.py": '"""Uses "ENGINE": "django.db.backends.mysql" in DATABASES."""\n# DATABASES = {"default": {"ENGINE": "django.db.backends.oracle"}}\nCACHES = {"default": {"ENGINE": "django.db.backends.sqlite3"}}\nNAMES = ["django.db.backends.postgresql"]\n',
      "site/local.py": 'def configure():\n    DATABASES = {"default": {"ENGINE": "django.db.backends.mysql"}}\n    return DATABASES\n',
      "tests/settings.py": settings('"django.db.backends.sqlite3"'),
      "site/test_settings.py": settings('"django.db.backends.sqlite3"'),
    };
    expect(stores(decoys).map((f) => f.subject)).toEqual(["No database found"]);
  });

  it("leaves out test settings in a settings package, so an unreadable product engine stays a medium SQL database", () => {
    const s = stores({
      "config/settings/base.py": 'import environ\nenv = environ.Env()\nDATABASES = {"default": env.db("DATABASE_URL")}\n',
      "config/settings/test.py": 'DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}\n',
      "shop/models.py": models,
    });
    expect(s.map((f) => `${f.subject}|${f.confidence}`)).toEqual(["SQL database (Django)|medium"]);
    expect(s[0]!.locations?.map((l) => l.file).sort()).toEqual(["config/settings/base.py", "shop/models.py"]);
  });

  it.each(["test.py", "tests.py", "testing.py"])("treats %s in a settings package or beside settings.py as test settings", (name) => {
    const sqlite = 'DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3"}}\n';
    const s = stores({
      "config/settings/production.py": settings('"django.db.backends.postgresql"'),
      [`config/settings/${name}`]: sqlite,
      [`site/${name}`]: sqlite,
      "site/settings.py": settings('"django.db.backends.postgresql"'),
    });
    expect(s.map((f) => `${f.subject}|${f.locations?.map((l) => l.file).join(",")}`)).toEqual([
      "PostgreSQL|config/settings/production.py,site/settings.py",
    ]);
  });

  it("keeps base, local, production and other settings modules", () => {
    const s = stores({
      "config/settings/base.py": settings('"django.db.backends.postgresql"'),
      "config/settings/local.py": settings('"django.db.backends.sqlite3"'),
      "config/settings/production.py": settings('"django.db.backends.mysql"'),
    });
    expect(s.map((f) => f.subject).sort()).toEqual(["MySQL", "PostgreSQL", "SQLite"]);
  });

  it("does not take any 0001 file under migrations/ for a Django migration", () => {
    expect(stores({ "db/migrations/0001_init.py": "import alembic\n" }).map((f) => f.subject)).toEqual(["No database found"]);
  });

  it("names each engine its settings set, once per engine", () => {
    const code = 'DATABASES = {\n    "default": {"ENGINE": "django.db.backends.postgresql"},\n    "legacy": {"ENGINE": "django.db.backends.mysql"},\n    "replica": {"ENGINE": "django.db.backends.postgresql"},\n}\n';
    const s = stores({ "site/settings.py": code, "site/settings_prod.py": code.replace(/\n {4}"legacy".*\n/, "\n") });
    expect(s.map((f) => `${f.subject}|${f.locations?.map((l) => `${l.file}:${l.line}`).join(",")}`).sort()).toEqual([
      "MySQL|site/settings.py:3",
      "PostgreSQL|site/settings.py:2,site/settings_prod.py:2",
    ]);
  });

  it("is one database when a driver import shows the same engine, and drops generic SQL once the engine is known", () => {
    const pg = stores({ "site/settings.py": settings('"django.db.backends.postgresql"'), "app/raw.py": "import psycopg\n" });
    expect(pg.map((f) => `${f.subject}|${f.detector}`)).toEqual(["PostgreSQL|data-store/postgres"]);
    expect(pg[0]!.locations).toEqual([{ file: "app/raw.py", line: 1 }, { file: "site/settings.py", line: 5 }]);
    const sa = stores({ "site/settings.py": settings('"django.db.backends.sqlite3"'), "app/db.py": "import sqlalchemy\n" });
    expect(sa.map((f) => f.subject)).toEqual(["SQLite"]);
    const generic = stores({ "site/settings.py": "DATABASES = {'default': env.db()}\n", "notes/models.py": models, "app/raw.py": "import psycopg\n" });
    expect(generic.map((f) => f.subject)).toEqual(["PostgreSQL"]);
  });
});
