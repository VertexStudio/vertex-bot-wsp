import axios from "axios";
import { Session } from "../models/Session";
import { setupLogger } from "../utils/logger";
import { Ollama } from "@langchain/ollama";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
const OLLAMA_API_URL_GENERATE = `${OLLAMA_API_URL}/api/generate`;
const OLLAMA_API_URL_CHAT = `${OLLAMA_API_URL}/api/chat`;
const OLLAMA_API_URL_EMBEDDING = `${OLLAMA_API_URL}/api/embeddings`;
const MODEL = process.env.MODEL || "llama3.1";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";

export const llm = new Ollama({
  baseUrl: OLLAMA_API_URL,
  model: MODEL,
  temperature: 0.3,
  topK: 20,
  topP: 0.45,
  numCtx: 30720,
});

setupLogger();

export async function callOllamaAPI(
  prompt: string,
  options: {
    system?: string;
    temperature?: number;
    top_k?: number;
    top_p?: number;
  } = {}
): Promise<string> {
  try {
    const response = await axios.post(OLLAMA_API_URL_GENERATE, {
      model: MODEL,
      prompt,
      system: options.system || Session.DEFAULT_SYSTEM_MESSAGE,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        top_k: options.top_k ?? 40,
        top_p: options.top_p ?? 0.9,
      },
    });

    return response.data.response;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}

export async function callOllamaAPIChat(
  messages: { role: string; content: string }[],
  options: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
    num_ctx?: number;
  } = {}
): Promise<{
  role: string;
  content: string;
}> {
  try {
    const response = await axios.post(OLLAMA_API_URL_CHAT, {
      model: MODEL,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        top_k: options.top_k ?? 40,
        top_p: options.top_p ?? 0.9,
        num_ctx: options.num_ctx ?? 2048,
      },
    });

    return response.data.message;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await axios.post(OLLAMA_API_URL_EMBEDDING, {
    model: EMBEDDING_MODEL,
    prompt: text,
  });
  return response.data.embedding;
}
