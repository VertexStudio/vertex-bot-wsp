import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { callOllamaAPIChat } from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";

const queueConfig: QueueConfig = { gapSeconds: 0 };
const enqueueMessage = createMessageQueue(queueConfig);

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { provider }) => {
    try {
      await typing(ctx, provider);
      enqueueMessage(ctx.body, async (body) => {
        console.log("Processed messages:", body);
        const userId = ctx.key.remoteJid;
        const userName = ctx.pushName || "User";

        if (!sessions.has(userId)) {
          sessions.set(userId, new Session());
        }
        const session = sessions.get(userId)!;

        session.addMessage({
          role: "user",
          content: `${userName}: ${body}`,
        });

        const response = await callOllamaAPIChat(session, {
          temperature: 0.3,
          top_k: 20,
          top_p: 0.45,
        });

        session.addMessage(response);

        console.log("Session messages: ", session.messages);

        let messageText = response.content;
        let mentions: string[] = [];

        if (ctx.key.participant) {
          messageText = `@${ctx.key.participant.split("@")[0]} ${messageText}`;
          mentions = [ctx.key.participant];
        }

        await sendMessage(
          provider,
          ctx.key.remoteJid,
          messageText,
          mentions,
          ctx
        );
      });
    } catch (error) {
      console.error("Error in welcomeFlow:", error);
      await sendMessage(
        provider,
        ctx.key.remoteJid,
        `Error in welcomeFlow: ${error.message}`,
        [],
        ctx
      );
    }
  }
);
