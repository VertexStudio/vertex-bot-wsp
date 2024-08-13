import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import axios from "axios";
import { createMessageQueue, QueueConfig } from '../utils/fast-entires'
const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

const OLLAMA_API_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3.1";

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
      system: options.system,
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

function processResponse(response: string, provider: any, ctx: any): void {
  const chunks = response.trim().split(/\n\n+/);

  chunks.forEach(async (chunk) => {
    const cleanedChunk = chunk.trim().replace(/【.*?】/g, "");
    const messageText = ctx.key.participant
      ? `@${ctx.key.participant.split('@')[0]} ${cleanedChunk}`
      : cleanedChunk;
    const mentions = ctx.key.participant ? [ctx.key.participant] : [];

    await provider.vendor.sendMessage(ctx.key.remoteJid, { text: messageText, mentions }, { quoted: ctx });
  });
}

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { state, provider }) => {
    try {
        await typing(ctx, provider);
        try {
            enqueueMessage(ctx.body, async (body) => {
                console.log('Processed messages:', body);
                const response = await callOllamaAPI(body);
                processResponse(response, provider, ctx);
            });
        } catch (error) {
            console.error('Error processing message:', error);
        }
    } catch (error) {
      console.error("Error in welcomeFlow:", error);
      processResponse("Error in welcomeFlow: " + error.message, provider, ctx);
    }
  }
);