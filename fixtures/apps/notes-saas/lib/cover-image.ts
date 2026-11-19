import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function coverImage(noteTitle: string) {
  const style = await client.responses.create({ model: "gpt-4o-mini", input: "Name one art style for a notebook cover." });
  return client.images.generate({ prompt: `${noteTitle}, in the style of ${style.output_text}`, size: "1024x1024" });
}
