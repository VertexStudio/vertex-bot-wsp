import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";
import { setupLogger } from "../utils/logger";
import { handleConversation } from "../services/conversationService";
import {
  processQuotedMessage,
  getRelevantMessages,
  getRelevantFacts,
} from "../services/messageProcessor";
import { buildPromptMessages } from "../services/promptBuilder";
import { sendResponse } from "../services/responseService";
import sendChatMessage from "~/services/actors/chat";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

setupLogger();

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { provider }) => {
    try {
      await typing(ctx, provider);

      const groupId = ctx.to.split("@")[0];
      const userId = ctx.key.remoteJid;
      const userName = ctx.pushName || "User";
      const userNumber = ctx.key.participant || ctx.key.remoteJid;

      const { latestMessagesEmbeddings, conversation } =
        await handleConversation(groupId);

      let session = sessions.get(userId);
      if (!session) {
        session = new Session(conversation.system_prompt);
        sessions.set(userId, session);
      }

      session.addParticipant(userNumber, userName);

      enqueueMessage(ctx.body, async (body) => {
        console.debug("Context: ", ctx);
        body = processQuotedMessage(ctx, session, userNumber, userName, body);

        const formattedMessages = await getRelevantMessages(
          body,
          latestMessagesEmbeddings
        );
        const relevantFactsText = await getRelevantFacts(body);

        const promptMessages = buildPromptMessages(
          conversation.system_prompt,
          relevantFactsText,
          formattedMessages,
          userName,
          body
        );

        const response = await sendChatMessage(promptMessages, true);

        console.debug("Response: ", response);

        const responseMessage = {
          role: "assistant",
          content: response.msg.message?.content || "",
        };

        const messagesToSave = [
          { role: "user", content: `${userName}: ${body}` },
          responseMessage,
        ];

        await session.addMessages(
          String(conversation.id.id),
          ...messagesToSave
        );

        console.debug("Messages: ", { ...promptMessages, responseMessage });
        console.log("Session participants: ", session.participants);

        await sendResponse(provider, ctx, responseMessage.content);
      });
    } catch (error) {
      console.error("Error in welcomeFlow:", error);
      await sendMessage(
        provider,
        ctx.key.remoteJid,
        `errorWelcome ${error.message}`
      );
    }
  }
);
