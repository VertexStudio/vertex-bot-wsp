import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { callOllamaAPIChat } from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
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
          const newSession = new Session();
          await newSession.initializeSystemMessageTokens();
          sessions.set(userId, newSession);
        }
        const session = sessions.get(userId)!;

        const userMessage = `${userName}: ${body}`;

        // Call the API with the user's message
        const response = await callOllamaAPIChat(
          session,
          {
            temperature: 0.3,
            top_k: 20,
            top_p: 0.45,
          },
          userMessage
        );

        // Calculate user message tokens
        const userMessageTokens = response.promptTokens - session.totalTokens;

        // Push both user and assistant messages at the same time
        session.addMessage([
          {
            role: "user",
            content: userMessage,
            tokens: userMessageTokens,
          },
          {
            role: "assistant",
            content: response.content,
            tokens: response.responseTokens,
          },
        ]);

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
