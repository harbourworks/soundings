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

  describe("which provider a prompt is sent to", () => {
    const flows = (code: string) =>
      evidenceOf({ "app/both.py": code })
        .facts.filter((f) => f.kind === "data_flow")
        .map((f) => `${f.subject}|${f.confidence}|${f.locations?.[0]?.line}`)
        .sort();
    const head = "from anthropic import Anthropic\nfrom openai import OpenAI\nclaude = Anthropic()\ngpt = OpenAI()\n";
    const toClaude = (content: string) => `    return claude.messages.create(model='m', max_tokens=8, messages=[{'role': 'user', 'content': ${content}}])\n`;
    const toGpt = (content: string) => `    return gpt.chat.completions.create(model='m', messages=[{'role': 'user', 'content': ${content}}])\n`;

    it("credits a flow only to the provider whose client makes the call, at that call's line", () => {
      expect(flows(`${head}def health():\n${toClaude("'fixed health check'")}def ask(question):\n${toGpt("question")}`)).toEqual(["OpenAI|high|8"]);
      expect(flows(`${head}def ask(question):\n${toClaude("question")}def health():\n${toGpt("'fixed health check'")}`)).toEqual(["Anthropic|high|6"]);
    });

    it("follows module imports, aliases and self attributes", () => {
      const mods = "import anthropic\nimport openai as oa\nclaude = anthropic.Anthropic()\ngpt = oa.OpenAI()\n";
      expect(flows(`${mods}def health():\n${toClaude("'ok'")}def ask(q):\n${toGpt("q")}`)).toEqual(["OpenAI|high|8"]);
      const cls = "from anthropic import Anthropic as A\nfrom openai import OpenAI\nclass Bot:\n    def __init__(self):\n        self.claude = A()\n        self.gpt = OpenAI()\n    def ask(self, q):\n        return self.claude.messages.create(model='m', messages=[{'role': 'user', 'content': q}])\n    def ping(self):\n        return self.gpt.responses.create(model='m', input='ping')\n";
      expect(flows(cls)).toEqual(["Anthropic|high|8"]);
      expect(flows(cls.replace("self.claude = A()", "self.claude: A = A()"))).toEqual(["Anthropic|high|8"]);
      const branch = "from anthropic import Anthropic\nfrom openai import OpenAI\nif FAST:\n    c = OpenAI()\nelse: c = Anthropic()\ndef ask(q):\n    return c.messages.create(model='m', messages=[{'role': 'user', 'content': q}])\n";
      expect(flows(branch)).toEqual(["Anthropic|low|7", "OpenAI|low|7"]);
      expect(flows(branch.replace("else: c = Anthropic()", "d = Anthropic()"))).toEqual(["OpenAI|high|7"]);
    });

    it("treats a client picked by a conditional expression, or by anything but one call or name, as unclear", () => {
      const pick = "import os\nfrom groq import Groq\nfrom openai import OpenAI\ndef reword(draft):\n    client = Groq() if os.environ.get('USE_GROQ') == '1' else OpenAI()\n    return client.chat.completions.create(model='m', messages=[{'role': 'user', 'content': draft}])\n";
      expect(flows(pick)).toEqual(["Groq|low|6", "OpenAI|low|6"]);
      const q = evidenceOf({ "app/both.py": pick }).unknowns.find((u) => u.id === "UQ-ai-destination-app-both-py");
      expect(q?.question).toBe("Which AI provider receives the prompt sent from app/both.py (line 6): Groq or OpenAI?");
      expect(flows(pick.replace("Groq() if os.environ.get('USE_GROQ') == '1' else OpenAI()", "OpenAI() or Groq()"))).toEqual(["Groq|low|6", "OpenAI|low|6"]);
      expect(flows(pick.replace("Groq() if os.environ.get('USE_GROQ') == '1' else OpenAI()", "(Groq() if FAST else OpenAI())"))).toEqual(["Groq|low|6", "OpenAI|low|6"]);
      // One call, with arguments, still binds; so does a call that awaits.
      expect(flows(pick.replace("Groq() if os.environ.get('USE_GROQ') == '1' else OpenAI()", "OpenAI(api_key=os.environ['K'], timeout=(1, 2))"))).toEqual(["OpenAI|high|6"]);
    });

    it("treats a client reassigned from something the scan can't resolve as unclear, but not one first set to None", () => {
      const re = `${head}from app.pick import pick_client\nif ALT:\n    gpt = pick_client()\ndef ask(q):\n${toGpt("q")}`;
      expect(flows(re)).toEqual(["Anthropic|low|9", "OpenAI|low|9"]);
      const alias = `${head}from app.pick import pick_client\nfast = gpt\nif ALT:\n    gpt = pick_client()\ndef ask(q):\n    return fast.chat.completions.create(model='m', messages=[{'role': 'user', 'content': q}])\n`;
      expect(flows(alias)).toEqual(["Anthropic|low|10", "OpenAI|low|10"]);
      const lazy = "from anthropic import Anthropic\nfrom openai import OpenAI\nclaude = Anthropic()\n_gpt = None\ndef ask(q):\n    global _gpt\n    _gpt = OpenAI()\n    return _gpt.chat.completions.create(model='m', messages=[{'role': 'user', 'content': q}])\n";
      expect(flows(lazy)).toEqual(["OpenAI|high|8"]);
    });

    it("gives a call it can't tie to one provider low confidence for each, and asks which one it is", () => {
      const code = `${head}from app.pick import pick\ndef ask(question):\n    return pick().messages.create(model='m', messages=[{'role': 'user', 'content': question}])\n`;
      expect(flows(code)).toEqual(["Anthropic|low|7", "OpenAI|low|7"]);
      const q = evidenceOf({ "app/both.py": code }).unknowns.find((u) => u.id === "UQ-ai-destination-app-both-py");
      expect(q?.question).toBe("Which AI provider receives the prompt sent from app/both.py (line 7): Anthropic or OpenAI?");
    });
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
