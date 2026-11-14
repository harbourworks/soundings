import OpenAI from "openai";
import Groq from "groq-sdk";

// Groq speaks the same API as OpenAI, so either client can serve this call.
const client = process.env.USE_GROQ === "1" ? new Groq() : new OpenAI();

export async function reword(draft: string) {
  const res = await client.chat.completions.create({
    model: process.env.REWORD_MODEL ?? "gpt-4o-mini",
    messages: [{ role: "user", content: `Reword this politely: ${draft}` }],
  });
  return res.choices[0]?.message.content;
}
