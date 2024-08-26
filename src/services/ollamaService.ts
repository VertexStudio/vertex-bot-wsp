import { Ollama } from "ollama";
import { Session } from "~/models/Session";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
const MODEL = process.env.MODEL || "llama3.1";

export const ollama = new Ollama({ host: OLLAMA_API_URL });

export async function callOllamaAPI(
  prompt: string,
  options: {
    system?: string;
    temperature?: number;
    top_k?: number;
    top_p?: number;
  } = {}
): Promise<{
  response: string;
  promptTokens: number;
  responseTokens: number;
  totalPromptEvalCount: number;
}> {
  try {
    const response = await ollama.generate({
      model: MODEL,
      prompt,
      system: options.system,
      options: {
        temperature: options.temperature,
        top_k: options.top_k,
        top_p: options.top_p,
      },
    });

    console.debug("Response Ollama API:", response);

    return {
      response: response.response,
      promptTokens: response.prompt_eval_count,
      responseTokens: response.eval_count,
      totalPromptEvalCount: response.prompt_eval_count,
    };
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}

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

const systemPromptTokensCache: { [key: string]: number } = {};

export async function getOrCalculateSystemPromptTokens(
  systemPrompt: string
): Promise<number> {
  const cacheKey = Buffer.from(systemPrompt).toString("base64");
  if (!(cacheKey in systemPromptTokensCache)) {
    systemPromptTokensCache[cacheKey] = await getSystemPromptTokens(
      systemPrompt
    );
  }
  return systemPromptTokensCache[cacheKey];
}
