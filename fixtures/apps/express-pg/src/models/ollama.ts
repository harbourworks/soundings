import ollama from "ollama";

export async function summarise(ticketText: string) {
  const res = await ollama.chat({
    model: "llama3.1",
    messages: [{ role: "user", content: `Summarise this ticket in one line: ${ticketText}` }],
  });
  return res.message.content;
}
