import { Ollama } from "ollama";
import { Session } from "~/models/Session";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://localhost:11434";
const MODEL = process.env.MODEL || "llama3.1";

const ollama = new Ollama({ host: OLLAMA_API_URL });

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

    return response.response;
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
  } = {}
): Promise<{
  role: string;
  content: string;
}> {
  try {
    const response = await ollama.chat({
      model: MODEL,
      messages: session.messages,
      options: {
        temperature: options.temperature,
        top_k: options.top_k,
        top_p: options.top_p,
      },
    });

    console.debug("Response Ollama API Chat:", response);

    return response.message;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}
