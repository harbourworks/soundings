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

  it("keeps SQLAlchemy evidence alongside a medium-confidence code URL and ignores Python decoys", () => {
    const e = evidenceOf({
      "app/db.py": 'from sqlalchemy import create_engine\nengine = create_engine("postgresql+psycopg://app@db:5432/app")\n',
      "app/notes.py": '"""mongodb://unused@db/notes"""\n# mysql://unused@db/notes\n',
    });
    const stores = e.facts.filter((f) => f.kind === "data_store").map((f) => [f.subject, f.detector, f.confidence]);
    expect(stores).toHaveLength(2);
    expect(stores).toEqual(expect.arrayContaining([
      ["SQL database (SQLAlchemy)", "data-store/sqlalchemy", "high"],
      ["PostgreSQL", "data-store/connection-string", "medium"],
    ]));
    expect(e.facts.find((f) => f.detector === "data-store/connection-string")?.claim).toContain("application code");
  });
});
