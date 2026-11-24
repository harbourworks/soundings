import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export async function* draftReply(ticketText: string) {
  const reply = await model.generateContentStream(`Draft a reply to this support ticket: ${ticketText}`);
  for await (const chunk of reply.stream) yield chunk.text();
}
