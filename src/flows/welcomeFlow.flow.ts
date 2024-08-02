import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import axios from "axios";

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
        const response = await callOllamaAPI(ctx.body);
        processResponse(response, flowDynamic);
    } catch (error) {
        console.error("Error in welcomeFlow:", error);
        processResponse("Error in welcomeFlow: " + error.message, flowDynamic);
    }
});
