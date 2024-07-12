import "dotenv/config";
const ASSISTANT_ID = process.env?.ASSISTANT_ID ?? "";
import {
    addKeyword,
    EVENTS,
} from "@builderbot/bot";
import { toAsk } from "@builderbot-plugins/openai-assistants";
import { typing } from "../utils/presence";
import { enqueueMessage } from '../utils/fast-entires'

function processResponse(response, flowDynamic) {
    const chunks = response.split(/\n\n+/);
    chunks.forEach(async chunk => {
        const cleanedChunk = chunk.trim().replace(/【.*?】/g, "");
        await flowDynamic([{ body: cleanedChunk }]);
    });
}

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(async (ctx, { flowDynamic, state, provider }) => {
    try {
        await typing(ctx, provider);
        const body = await enqueueMessage(ctx.body)
        console.log(body)
        const response = await toAsk(ASSISTANT_ID, body, state);
        processResponse(response, flowDynamic);
    } catch (error) {
        console.error("Error in welcomeFlow:", error);
    }
});