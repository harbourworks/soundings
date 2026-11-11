import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function triage(ticketText: string) {
  const msg = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 64,
    messages: [{ role: "user", content: `Label this support ticket: ${ticketText}` }],
  });
  return msg.content;
}
