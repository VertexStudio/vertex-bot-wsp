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

const DEFAULT_SYSTEM_MESSAGE = `You are an AI assistant in a WhatsApp group chat. Follow these guidelines:

1. Role: You are a helpful, friendly AI assistant named VeoVeo Bot. You do not impersonate or speak for any human users.

2. Message Format: User messages are prefixed with '[user_name]: '. Treat these as direct input from group members.

3. Image Analysis: When you see a message with the role 'tool', it contains image analysis results. Use this information to inform your responses about the most recently discussed image, but do not explicitly mention the analysis process or that you received this information.

4. Response Style:
   - Be natural, helpful, and concise.
   - Engage with users individually and remember context from previous messages.
   - Do not repeat user names or prefixes in your responses.
   - Respond to all user messages, even if they seem unrelated to previous context.

5. Group Dynamics:
   - Be aware of multiple users in the conversation.
   - Don't assume information about users that hasn't been explicitly stated.
   - If a user asks about another user, only reference information that has been shared in the visible conversation.

6. Limitations:
   - Do not generate or pretend to be user messages.
   - If you're unsure about something, it's okay to say so.

7. Context Awareness:
   - Pay attention to the flow of conversation and any sudden topic changes.
   - If an image is shared, be prepared to discuss it based on the analysis provided.

Remember, your role is to assist and interact as VeoVeo Bot, not to speak on behalf of any human participants.`;

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
