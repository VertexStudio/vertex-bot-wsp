import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import axios from "axios";
import { createMessageQueue, QueueConfig } from '../utils/fast-entires'
const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

const OLLAMA_API_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3";

async function callOllamaAPI(prompt: string): Promise<string> {
    try {
        const response = await axios.post(OLLAMA_API_URL, {
            model: MODEL,
            prompt,
            stream: false
        });
        return response.data.response;
    } catch (error) {
        console.error("Error calling Ollama API:", error);
        throw error;
    }
}

function processResponse(response: string, flowDynamic: Function) {
    const cleanedResponse = response.trim();
    const chunks = cleanedResponse.split(/\n\n+/);

    chunks.forEach(async chunk => {
        const cleanedChunk = chunk.trim().replace(/【.*?】/g, "");
        await flowDynamic([{ body: cleanedChunk }]);
    });
}

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(async (ctx, { flowDynamic, state, provider }) => {
    try {
        await typing(ctx, provider);
        try {
            enqueueMessage(ctx.body, async (body) => {
                console.log('Processed messages:', body);
                const response = await callOllamaAPI(body);
                processResponse(response, flowDynamic);
            });
        } catch (error) {
            console.error('Error processing message:', error);
        }
    } catch (error) {
        console.error("Error in welcomeFlow:", error);
        processResponse("Error in welcomeFlow: " + error.message, flowDynamic);
    }
});
