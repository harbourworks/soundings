// We benchmarked groq-sdk and @mistralai/mistralai for summaries; neither is installed.
// import Groq from "groq-sdk";
export const EVALUATED_SDKS = ["groq-sdk", "@mistralai/mistralai"];
export const NOTE = 'Switching would mean `import { Mistral } from "@mistralai/mistralai"`, which we have not done.';
