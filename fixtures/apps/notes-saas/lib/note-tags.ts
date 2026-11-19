import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TAGS_SCHEMA = { type: "object", properties: { tags: { type: "array", items: { type: "string" } } }, required: ["tags"] };

export async function suggestTags(noteText: string) {
  const res = await client.responses.parse({
    model: "gpt-4o-mini",
    input: [{ role: "user", content: noteText }],
    text: { format: { type: "json_schema", name: "tags", schema: TAGS_SCHEMA } },
  });
  return res.output_parsed;
}
