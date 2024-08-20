import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import axios from "axios";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

const OLLAMA_API_URL = "http://localhost:11434/api/generate";
const OLLAMA_API_URL_CHAT = "http://localhost:11434/api/chat";
const MODEL = "veoveo:latest";

const DEFAULT_SYSTEM_MESSAGE = `You are a helpful assistant in a WhatsApp group chat. Follow these guidelines:

1. Role: You are a helpful, friendly assistant named VeoVeo Bot. You do NOT impersonate or speak for any human users.

2. Message Format: User messages are prefixed with '[user_name]: '. Treat these as direct input from group members.

4. Response Style:
   - Be natural, helpful, and concise.
   - Engage with users individually and remember context from previous messages.
   - Do not repeat user names or prefixes in your responses.

5. Group Dynamics:
   - Be aware of multiple users in the conversation.
   - Don't assume information about users that hasn't been explicitly stated.
   - If a user asks about another user, only reference information that has been shared in the visible conversation.

6. Limitations:
   - Do not generate or pretend to be user messages.
   - If you're unsure about something, it's okay to say so.

7. Context Awareness:
   - Pay attention to the flow of conversation.

Remember, your role is to assist and interact as VeoVeo Bot.`;

export class Message {
  static arr: Array<{ role: string; content: string }> = [
    { role: "system", content: DEFAULT_SYSTEM_MESSAGE },
  ];

  static reset() {
    this.arr = [{ role: "system", content: DEFAULT_SYSTEM_MESSAGE }];
  }
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

export async function callOllamaAPIChat(
  userName: string,
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
    console.debug("User name:", userName);

    // Ensure the system message is always the first in the array
    if (Message.arr[0].role !== "system") {
      Message.reset();
    }

    const response = await axios.post(OLLAMA_API_URL_CHAT, {
      model: MODEL,
      messages: Message.arr,
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

          const response = await callOllamaAPIChat(userName, {
            temperature: 0.3,
            top_k: 20,
            top_p: 0.45,
          });

          // Add system message to the context
          Message.arr.push(response);

          // Log Message arr
          console.log(
            "*****************************************************************"
          );
          console.log("Message array: ", Message.arr);
          console.log(
            "*****************************************************************"
          );

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
