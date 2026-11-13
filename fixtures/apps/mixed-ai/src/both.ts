import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const o = new OpenAI();
const a = new Anthropic();

export async function ask(question: string) {
  return o.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: question }] });
}

export async function healthCheck() {
  return a.messages.create({ model: "claude-haiku-5-5", max_tokens: 8, messages: [{ role: "user", content: "fixed health check" }] });
}
