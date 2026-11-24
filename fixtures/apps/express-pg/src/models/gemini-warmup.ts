import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Checks the model answers before the first real request. Both prompts are fixed text: nothing a user wrote is sent.
export async function warmUp() {
  await model.generateContent("ping");
  await model.generateContent(`Reply with OK.`);
}
