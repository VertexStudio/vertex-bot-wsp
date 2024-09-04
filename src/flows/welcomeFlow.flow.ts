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

type EmbeddingData = {
  id: RecordId;
  vector: number[];
};

type Message = {
  content: string;
  created_at: string;
  embedding: EmbeddingData;
  id: RecordId;
  role: RecordId;
};

// Initialize SurrealDB connection
export async function handleConversation(
  groupId: string
): Promise<
  { latestMessagesEmbeddings: unknown; conversation: Conversation } | []
> {
  const db = getDb();

  // Check if conversation exists
  const [result] = await db.query<Conversation[]>(`
    SELECT * FROM conversation WHERE whatsapp_id = '${groupId}'
  `);
  let conversation: Conversation | null =
    Array.isArray(result) && result.length > 0 ? result[0] : null;

  if (
    !conversation ||
    (Array.isArray(conversation) && conversation.length === 0)
  ) {
    const [result] = await db.query<Conversation[]>(`
      CREATE conversation SET 
        id = crypto::sha256("whatsapp//${groupId}"),
        whatsapp_id = '${groupId}'
    `);
    conversation = result[0];
    return { latestMessagesEmbeddings: [], conversation };
  } else {
    const [latestMessagesEmbeddings] = await db.query<Message[]>(`
      SELECT 
          *,
          (->message_embedding->embedding)[0].* AS embedding,
          (->message_role->role)[0] AS role
      FROM (
          SELECT ->conversation_messages->message AS message 
          FROM conversation 
          WHERE whatsapp_id = '${groupId}'
      )[0].message 
      ORDER BY created_at 
      LIMIT 30;
    `);
    return { latestMessagesEmbeddings, conversation };
  }
}

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { provider }) => {
    console.debug("Context: ", ctx);
    try {
      await typing(ctx, provider);

      const groupId = ctx.to.split("@")[0];
      const userId = ctx.key.remoteJid;
      const userName = ctx.pushName || "User";

      if (!sessions.has(userId)) {
        sessions.set(userId, new Session());
      }
      const session = sessions.get(userId)!;

      const result = await handleConversation(groupId);
      const { latestMessagesEmbeddings, conversation } = Array.isArray(result)
        ? { latestMessagesEmbeddings: [], conversation: null }
        : result;

      enqueueMessage(ctx.body, async (body) => {
        const queryEmbedding = await generateEmbedding(body);

        const latestMessages = (latestMessagesEmbeddings as Message[]).slice(
          -10
        );
        const olderMessages = (latestMessagesEmbeddings as Message[]).slice(
          0,
          -10
        );

        const similarities = olderMessages.map((msg) => ({
          id: msg.id,
          embedding: msg.embedding.vector,
          similarity: cosineSimilarity(queryEmbedding, msg.embedding.vector),
          content: msg.content,
          role: msg.role.id,
        }));

        const similarityThreshold = 0.5;
        const topSimilarities = similarities
          .sort((a, b) => b.similarity - a.similarity)
          .filter((item) => item.similarity >= similarityThreshold);

        console.debug(
          "Top similarities roles:",
          topSimilarities.map((s) => s.role)
        );

        const formattedMessages = [
          ...topSimilarities.map((msg) => ({
            role: String(msg.role),
            content: msg.content,
          })),
          ...latestMessages.map((msg) => ({
            role: String(msg.role.id),
            content: msg.content,
          })),
        ];

        const systemPrompt = {
          role: "system",
          content: Session.DEFAULT_SYSTEM_MESSAGE,
        };

        const promptMessages = [
          systemPrompt,
          ...formattedMessages,
          { role: "user", content: `${userName}: ${body}` },
        ];

        const response = await callOllamaAPIChat(promptMessages, {
          temperature: 0.3,
          top_k: 20,
          top_p: 0.45,
          num_ctx: 30720,
        });

        const responseMessage = {
          role: "assistant",
          content: response.content,
        };

        // Exclude the system message when saving to the database
        const messagesToSave = [
          { role: "user", content: `${userName}: ${body}` },
          responseMessage,
        ];

        session.addMessages(String(conversation.id.id), ...messagesToSave);

        console.debug("Messages: ", { ...promptMessages, responseMessage });

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
