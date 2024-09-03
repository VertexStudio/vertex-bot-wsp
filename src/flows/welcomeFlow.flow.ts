import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import {
  callOllamaAPIChat,
  generateEmbedding,
} from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";
import { setupLogger } from "../utils/logger";
import { RecordId, Surreal } from "surrealdb.js";
import { getDb } from "~/database/surreal";
import { cosineSimilarity } from "../utils/vectorUtils";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

setupLogger();

type Conversation = {
  id: RecordId;
  whatsapp_id: string;
};

// Initialize SurrealDB connection
export async function handleConversation(
  groupId: string
): Promise<{ latestMessagesEmbeddings: unknown; conversation: any } | []> {
  const db = getDb();

  // Check if conversation exists
  const [result] = await db.query<Conversation[]>(`
    SELECT * FROM conversation WHERE whatsapp_id = '${groupId}'
  `);
  console.debug("Conversation result: ", result[0]);

  // Check if result is an array and has a non-empty first element
  const conversation =
    Array.isArray(result) && result.length > 0 ? result[0] : null;

  if (
    !conversation ||
    (Array.isArray(conversation) && conversation.length === 0)
  ) {
    console.debug(`Creating new conversation for group ${groupId}`);
    // Create new conversation
    await db.query(`
      CREATE conversation SET 
        id = crypto::sha256("whatsapp//${groupId}"),
        whatsapp_id = '${groupId}'
    `);
    console.log(`Created new conversation for group ${groupId}`);
    return { latestMessagesEmbeddings: [], conversation: null };
  } else {
    // Fetch latest messages (e.g., last 10)
    const [latestMessagesEmbeddings] = await db.query(`
      SELECT * FROM (SELECT 
        ->conversation_messages->message->message_embedding->embedding AS embedding,
        ->conversation_messages->message.created_at AS created_at 
      FROM conversation
      WHERE whatsapp_id = '${groupId}'
      ORDER BY created_at ASC 
      LIMIT 1)[0].embedding LIMIT 10;
    `);
    console.log(
      `Fetched latest messages for group ${groupId}:`,
      latestMessagesEmbeddings
    );
    return { latestMessagesEmbeddings, conversation };
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
      const result = await handleConversation(groupId);
      const { latestMessagesEmbeddings, conversation } = Array.isArray(result)
        ? { latestMessagesEmbeddings: [], conversation: null }
        : result;

      enqueueMessage(ctx.body, async (body) => {
        // Log the user's query
        console.debug("User query:", body);

        // Generate embedding for the user query
        const queryEmbedding = await generateEmbedding(body);
        console.debug("Query embedding:", queryEmbedding);

        // // Calculate similarities and log them
        // const similarities = latestMessages.map((msg) => ({
        //   embedding: msg.embedding,
        //   similarity: cosineSimilarity(queryEmbedding, msg.embedding),
        // }));

        // console.log("Similarities:", similarities);

        // // Log the sorted similarities
        // const sortedSimilarities = similarities.sort(
        //   (a, b) => b.similarity - a.similarity
        // );
        // console.log("Sorted similarities:", sortedSimilarities);

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

        await session.addMessages(
          conversation.id.id,
          { role: "user", content: `${userName}: ${body}` },
          response
        );

        console.debug("Session messages: ", session.messages);

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
        console.log(
          "Latest messages from SurrealDB:",
          latestMessagesEmbeddings
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
