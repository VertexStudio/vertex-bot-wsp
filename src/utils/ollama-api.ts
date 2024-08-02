import axios from "axios";

const OLLAMA_API_URL =
  process.env.OLLAMA_API_URL || "http://localhost:11434/api/chat";
const MODEL = "llama3.1:70b";

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
        temperature: 0.4,
        seed: 42,
        top_k: 20,
        top_p: 0.5,
      },
    });

    return response.data.message.content.trim();
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}
