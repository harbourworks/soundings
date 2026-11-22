import { toFile } from "openai/uploads";
import { openai } from "./client";

export async function upload(bytes: Buffer) {
  return openai.files.create({ file: await toFile(bytes, "data.jsonl"), purpose: "batch" });
}
