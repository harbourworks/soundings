import Groq from "groq-sdk";

const groq = new Groq();

export async function language(ticketText: string) {
  const res = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: `Which language is this written in? ${ticketText}` }],
  });
  return res.choices[0]?.message.content;
}
