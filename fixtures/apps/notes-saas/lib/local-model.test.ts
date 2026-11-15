// A spike: summaries from a model run by Ollama. The app does not call this.
import ollama from "ollama";

export const spike = () => ollama.chat({ model: "llama3.1", messages: [{ role: "user", content: "Say hello." }] });
