import { CohereClientV2 } from "cohere-ai";

const cohere = new CohereClientV2({});

export async function suggestReply(ticketText: string) {
  const res = await cohere.chat({
    model: "command-r",
    messages: [{ role: "user", content: `Suggest a polite first reply to: ${ticketText}` }],
  });
  return res.message;
}
