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
