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
import { Query } from "~/services/actors/embeddings";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

setupLogger();

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { provider }) => {
    try {
      await typing(ctx, provider);

      const groupId = ctx.to.split("@")[0];
      const userName = ctx.pushName || "User";
      const userNumber = ctx.key.participant || ctx.key.remoteJid;

      // Fetch or create the session for the group
      let session = sessions.get(groupId);
      if (!session) {
        const { conversation, latestMessages } = await handleConversation(
          groupId
        );
        session = new Session(conversation.system_prompt);
        session.conversation = conversation;
        session.messages = latestMessages;
        sessions.set(groupId, session);
      }

      session.addParticipant(userNumber, userName);

      enqueueMessage(ctx.body, async (body) => {
        body = processQuotedMessage(ctx, session, userNumber, userName, body);

        const query: Query = {
          Text: body,
          Embedding: [],
        };

        const formattedMessages = await getRelevantMessages(
          query,
          session.messages
        );
        const relevantFactsText = await getRelevantFacts(query);

        const promptMessages = buildPromptMessages(
          session.conversation.system_prompt,
          relevantFactsText,
          formattedMessages,
          userName,
          body
        );

        console.log("Prompt messages: ", { ...promptMessages });

        const response = await sendChatMessage(promptMessages, true);

        const messagesToSave = [
          {
            role: "user" as const,
            msg: `${userName}: ${body}`,
          },
          {
            role: "assistant" as const,
            msg: response.msg.message?.content || "",
          },
        ];

        await session.addMessages(
          String(session.conversation.id.id),
          ...messagesToSave
        );

        await sendResponse(provider, ctx, messagesToSave[1].msg);
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
