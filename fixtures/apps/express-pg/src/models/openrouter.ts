import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter();

export async function tags(ticketText: string) {
  const res = await openRouter.chat.send({
    chatRequest: {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: `Suggest three tags for: ${ticketText}` }],
    },
  });
  return res.choices[0]?.message.content;
}
