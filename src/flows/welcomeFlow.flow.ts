import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import {
  callOllamaAPIChat,
  generateEmbedding,
} from "../services/ollamaService";
import { Session } from "../models/Session";
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

type EmbeddingData = {
  id: RecordId;
  vector: number[];
};

type Message = {
  id: RecordId;
  content: string;
  created_at: string;
};

type MessageWithRole = {
  message: Message;
  role: RecordId;
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
  let conversation: Conversation | null =
    Array.isArray(result) && result.length > 0 ? result[0] : null;

  if (
    !conversation ||
    (Array.isArray(conversation) && conversation.length === 0)
  ) {
    console.debug(`Creating new conversation for group ${groupId}`);
    // Create new conversation
    const [result] = await db.query<Conversation[]>(`
      CREATE conversation SET 
        id = crypto::sha256("whatsapp//${groupId}"),
        whatsapp_id = '${groupId}'
    `);
    conversation = result[0];
    console.debug("Conversation result: ", conversation);
    console.log(`Created new conversation for group ${groupId}`);
    return { latestMessagesEmbeddings: [], conversation };
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
    const db = getDb();
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

        // Calculate similarities and log them
        const similarities =
          (latestMessagesEmbeddings as EmbeddingData[]).map((msg) => ({
            id: msg.id,
            embedding: msg.vector,
            similarity: cosineSimilarity(queryEmbedding, msg.vector),
          })) || [];

        console.debug("Similarities:", similarities);

        // Sort similarities and select based on threshold
        const similarityThreshold = 0.5;
        const topSimilarities = similarities
          .sort((a, b) => b.similarity - a.similarity)
          .filter((item) => item.similarity >= similarityThreshold);

        console.debug("Top similarities:", topSimilarities);

        let messages: MessageWithRole[] = [];

        if (topSimilarities.length > 0) {
          const embeddingIds = topSimilarities
            .map((sim) => `embedding:${sim.id.id}`)
            .join(", ");
          const [result] = await db.query<[MessageWithRole[]]>(`
            (
              SELECT 
                (<-message_embedding.in.*)[0] AS message,
                (<-message_embedding.in->message_role.out)[0] AS role 
              FROM ${embeddingIds}
            )
          `);
          messages = Array.isArray(result) ? result : [];
        } else {
          console.debug("No similar messages found");
        }

        console.debug("Related messages:", messages);

        const formattedMessages = messages.map((msg) => ({
          role: String(msg.role.id),
          content: msg.message.content,
        }));

        const userId = ctx.key.remoteJid;
        const userName = ctx.pushName || "User";

        const finalMessages = [
          { role: "system", content: Session.DEFAULT_SYSTEM_MESSAGE },
          ...formattedMessages,
          { role: "user", content: `${userName}: ${body}` },
        ];

        console.debug("Formatted messages:", finalMessages);

        const response = await callOllamaAPIChat(finalMessages, {
          temperature: 0.3,
          top_k: 20,
          top_p: 0.45,
          num_ctx: 30720,
        });

        let messageText = response.content;
        let mentions: string[] = [];

        if (ctx.key.participant) {
          messageText = `@${ctx.key.participant.split("@")[0]} ${messageText}`;
          mentions = [ctx.key.participant];
        }

        await sendMessage(provider, userId, messageText, mentions, ctx);
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
