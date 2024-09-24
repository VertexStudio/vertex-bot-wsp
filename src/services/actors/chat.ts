import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const BIOMA_DB_URL = `${process.env.BIOMA_DB_PROTOCOL}://${process.env.BIOMA_DB_HOST}:${process.env.BIOMA_DB_PORT}`;
const BIOMA_DB_NAMESPACE = process.env.BIOMA_DB_NAMESPACE;
const BIOMA_DB_DATABASE = process.env.BIOMA_DB_DATABASE;
const BIOMA_DB_USER = process.env.BIOMA_DB_USER;
const BIOMA_DB_PASSWORD = process.env.BIOMA_DB_PASSWORD;

const bioma = new BiomaInterface();

await bioma.connect(
  BIOMA_DB_URL || "ws://127.0.0.1:8000",
  BIOMA_DB_NAMESPACE || "dev",
  BIOMA_DB_DATABASE || "bioma",
  BIOMA_DB_USER || "root",
  BIOMA_DB_PASSWORD || "root"
);

export type ChatMessageRole = "user" | "assistant" | "system" | "tool";

export type ChatMessage = {
  role: ChatMessageRole;
  content: string;
  images?: string[];
};

type ChatResult = {
  model: string;
  created_at: string;
  message: ChatMessage | null;
  done: boolean;
  final_data?: {};
};

async function sendChatMessage(
  messages: ChatMessage[],
  restart: boolean
): Promise<ChatResult> {
  try {
    const vertexChatId = bioma.createActorId("/vertex-chat", "chat::ChatActor");
    const vertexChat = await bioma.createActor(vertexChatId);

    const chatId = bioma.createActorId("/chat", "chat::ChatService");

    const sendMessage = {
      messages,
      restart,
    };

    const messageId = await bioma.sendMessage(
      vertexChatId,
      chatId,
      "chat::chat::ProcessChat",
      sendMessage
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    return reply as ChatResult;
  } catch (error) {
    console.error("Error in sendChatMessage:", error);
    throw error;
  }
}

export default sendChatMessage;
