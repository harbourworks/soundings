import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "./client";

const Person = z.object({ name: z.string() });

export async function extract(text: string) {
  return openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: text }],
    response_format: zodResponseFormat(Person, "person"),
  });
}
