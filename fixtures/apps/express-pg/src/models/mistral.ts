import { Mistral } from "@mistralai/mistralai";

const client = new Mistral();

export async function summarise(ticketText: string) {
  const res = await client.chat.complete({
    model: "mistral-small-latest",
    messages: [{ role: "user", content: `Summarise this support ticket in one line: ${ticketText}` }],
  });
  return res.choices?.[0]?.message?.content;
}
