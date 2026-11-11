import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const body = await req.json();
  console.log("summarise request", body);
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: `Summarise this note: ${body.noteText}` }],
  });
  return Response.json({ summary: completion.choices[0]?.message.content });
}
