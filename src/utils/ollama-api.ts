import axios from "axios";

const OLLAMA_API_URL =
  process.env.OLLAMA_API_URL || "http://localhost:11434/api/chat";
const MODEL = "llama3.1";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface OllamaResponse {
  message: {
    content: string;
  };
}

export async function callOllamaChatAPI(messages: Message[]): Promise<string> {
  console.debug("MESSAGES: ", messages);
  try {
    const response = await axios.post<OllamaResponse>(OLLAMA_API_URL, {
      model: MODEL,
      messages: messages,
      stream: false,
      options: {
        temperature: 0,
        top_k: 10,
        top_p: 0.25,
      },
    });

    return response.data.message.content.trim();
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}
