import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Seeds a new account's first notebook. Every prompt here is fixed text: nothing a user wrote is sent.
export async function sampleNotebook() {
  const cover = await client.images.generate({ prompt: "a cat", size: "1024x1024" });
  const name = await client.responses.parse({ model: "gpt-4o-mini", input: "Suggest a name for a new notebook." });
  return { cover, name };
}
