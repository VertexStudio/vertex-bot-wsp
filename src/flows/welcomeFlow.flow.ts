import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { callOllamaAPIChat } from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";
import { RecordId, Surreal } from "surrealdb.js";
import { getDb } from "~/database/surreal";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

type Conversation = {
  id: string;
};

// Initialize SurrealDB connection
async function handleConversation(groupId: string) {
  const db = getDb();

  // Check if conversation exists
  const [conversation] = await db.query(`
    SELECT * FROM conversation WHERE whatsapp_id = '${groupId}'
  `);
  console.debug("Conversation: ", conversation);

  if (!conversation) {
    // Create new conversation
    await db.query(`
      CREATE conversation SET 
        id = crypto::sha256("whatsapp//${groupId}"),
        whatsapp_id = '${groupId}'
    `);
    console.log(`Created new conversation for group ${groupId}`);
    return [];
  } else {
    // Fetch latest messages (e.g., last 10)
    const latestMessages = await db.query(`
      (SELECT * FROM message WHERE (SELECT ->conversation_messages.out FROM conversation:${groupId} LIMIT 10))[0].content
    `);
    console.log(
      `Fetched latest messages for group ${groupId}:`,
      latestMessages
    );
    return latestMessages;
  }
}

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { provider }) => {
    console.debug("Context: ", ctx);
    try {
      await typing(ctx, provider);

      // Extract group ID
      const groupId = ctx.to.split("@")[0];

      // Handle conversation in SurrealDB
      const latestMessages = await handleConversation(groupId);

      enqueueMessage(ctx.body, async (body) => {
        console.log("Processed messages:", body);
        const userId = ctx.key.remoteJid;
        const userName = ctx.pushName || "User";

        if (!sessions.has(userId)) {
          sessions.set(userId, new Session());
        }
        const session = sessions.get(userId)!;

        const response = await callOllamaAPIChat(session, body, {
          temperature: 0.3,
          top_k: 20,
          top_p: 0.45,
          num_ctx: 30720,
        });

        session.addMessages(
          { role: "user", content: `${userName}: ${body}` },
          response
        );

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

        // Log latest messages (you can use this data later if needed)
        console.log("Latest messages from SurrealDB:", latestMessages);
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
