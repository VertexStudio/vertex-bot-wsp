import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import axios from "axios";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

const OLLAMA_API_URL = "http://localhost:11434/api/generate";
const OLLAMA_API_URL_CHAT = "http://localhost:11434/api/chat";
const MODEL = "llama3.1";

const DEFAULT_SYSTEM_MESSAGE = `You are a helpful AI assistant in a WhatsApp group with many people. You'll see messages prefixed with '[user_name]: ' which are from group members, and tool results which are image analysis results, right after the user's query about an image. Respond naturally, helpfully and concisely to user queries. Don't mention the image analysis process, raw analysis results, or that an analysis was performed at all.`;

export class Message {
  static arr: Array<{ role: string; content: string }> = [];
}

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
    const response = await axios.post(OLLAMA_API_URL, {
      model: MODEL,
      prompt,
      system: options.system || DEFAULT_SYSTEM_MESSAGE,
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

export async function callOllamaAPIChat(userName: string): Promise<{
  role: string;
  content: string;
}> {
  try {
    console.debug("User name:", userName);

    const response = await axios.post(OLLAMA_API_URL_CHAT, {
      model: MODEL,
      messages: Message.arr,
      stream: false,
    });

    console.debug("Response Ollama API Chat:", response.data);

    return response.data.message;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { state, provider }) => {
    try {
      await typing(ctx, provider);
      try {
        enqueueMessage(ctx.body, async (body) => {
          console.log("Processed messages:", body);
          const userId = ctx.key.remoteJid;
          const userName = ctx.pushName || "User";

          Message.arr.push({
            role: "user",
            content: `${userName}: ` + body,
          });

          // Log Message arr
          console.log(
            "*****************************************************************"
          );
          console.log("Message array: ", Message.arr);
          console.log(
            "*****************************************************************"
          );

          const response = await callOllamaAPIChat(userName);

          // Add system message to the context
          Message.arr.push(response);

          // Prepare the message text and mentions
          let messageText = response.content;
          let mentions = [];

          if (ctx.key.participant) {
            messageText =
              "@" + ctx.key.participant.split("@")[0] + " " + messageText;
            mentions = [ctx.key.participant];
          }

          provider.vendor.sendMessage(
            ctx.key.remoteJid,
            { text: messageText, mentions },
            { quoted: ctx }
          );
        });
      } catch (error) {
        console.error("Error processing message:", error);
      }
    } catch (error) {
      console.error("Error in welcomeFlow:", error);
      provider.vendor.sendMessage(
        ctx.key.remoteJid,
        { text: "Error in welcomeFlow: " + error.message },
        { quoted: ctx }
      );
    }
  }
);
