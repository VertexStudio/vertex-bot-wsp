import { Ollama } from "ollama";
import { Session } from "~/models/Session";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
export const MODEL = process.env.MODEL || "llama3.1";

export const ollama = new Ollama({ host: OLLAMA_API_URL });

export async function callOllamaAPIChat(
  session: Session,
  options: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
  } = {},
  userMessage?: string
): Promise<{
  role: string;
  content: string;
  promptTokens: number;
  responseTokens: number;
}> {
  try {
    const messages = userMessage
      ? [...session.messages, { role: "user", content: userMessage }]
      : session.messages;

    const response = await ollama.chat({
      model: MODEL,
      messages: messages,
      options: {
        temperature: options.temperature,
        top_k: options.top_k,
        top_p: options.top_p,
      },
    });

    console.debug("Response Ollama API Chat:", response);

    const promptTokens = response.prompt_eval_count;
    const responseTokens = response.eval_count;

    return {
      ...response.message,
      promptTokens,
      responseTokens,
    };
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}

export async function getSystemPromptTokens(
  systemPrompt: string
): Promise<number> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [{ role: "system", content: systemPrompt }],
  });
  return response.prompt_eval_count;
}
