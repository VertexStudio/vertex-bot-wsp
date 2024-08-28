import axios from "axios";
import { Session } from "../models/Session";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
const OLLAMA_API_URL_GENERATE = `${OLLAMA_API_URL}/api/generate`;
const OLLAMA_API_URL_CHAT = `${OLLAMA_API_URL}/api/chat`;
const MODEL = process.env.MODEL || "llama3.1";

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
  session: Session,
  userMessage: string,
  options: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
  } = {}
): Promise<{
  role: string;
  content: string;
}> {
  try {
    const response = await axios.post(OLLAMA_API_URL_CHAT, {
      model: MODEL,
      messages: [...session.messages, { role: "user", content: userMessage }],
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        top_k: options.top_k ?? 40,
        top_p: options.top_p ?? 0.9,
      },
    });

    console.debug("Response Ollama API Chat:", response.data);

    return response.data.message;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}
