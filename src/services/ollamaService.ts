import { Ollama } from "ollama";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
export const MODEL = process.env.MODEL || "llama3.1";

export const ollama = new Ollama({ host: OLLAMA_API_URL });

export async function getSystemPromptTokens(
  systemPrompt: string
): Promise<number> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [{ role: "system", content: systemPrompt }],
  });
  return response.prompt_eval_count;
}
