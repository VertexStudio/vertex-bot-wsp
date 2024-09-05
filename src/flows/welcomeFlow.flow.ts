import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import {
  callOllamaAPIChat,
  generateEmbedding,
  llm,
} from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";
import { setupLogger } from "../utils/logger";
import { RecordId } from "surrealdb.js";
import { getDb } from "~/database/surreal";
import { cosineSimilarity } from "../utils/vectorUtils";
import { facts } from "~/app";

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
    // TODO: See a way to not hardcode the limit.
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
      const userNumber = ctx.key.participant || ctx.key.remoteJid;

      if (!sessions.has(userId)) {
        sessions.set(userId, new Session());
      }
      const session = sessions.get(userId)!;

      session.addParticipant(userNumber, userName);

      // TODO: Get conversation only once.
      const result = await handleConversation(groupId);
      const { latestMessagesEmbeddings, conversation } = Array.isArray(result)
        ? { latestMessagesEmbeddings: [], conversation: null }
        : result;

      enqueueMessage(ctx.body, async (body) => {
        // Handle quoted messages
        if (ctx.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
          const quotedMessage =
            ctx.message.extendedTextMessage.contextInfo.quotedMessage
              .extendedTextMessage?.text ||
            ctx.message.extendedTextMessage.contextInfo.quotedMessage
              .conversation;

          if (quotedMessage) {
            const quotedParticipantNumber =
              ctx.message.extendedTextMessage.contextInfo.participant ||
              ctx.message.extendedTextMessage.contextInfo.mentionedJid[0];
            const quotedParticipantName = session.getParticipantName(
              quotedParticipantNumber
            );

            if (!session.quotesByUser[userNumber]) {
              session.createQuotesByUser(userNumber);
            }

            session.addQuoteByUser(
              userNumber,
              `${quotedParticipantName}: ${quotedMessage}`
            );
            const quotes = session.getQuotesByUser(userNumber);
            body = `quotes: ${quotes} User ${userName} prompt: ${ctx.body}`;
          }
        }

        // TODO: Figure out how to do embeddings only once. No need to do it twice (here and in VV DB).
        const queryEmbedding = await generateEmbedding(body);

        // Convert latestMessagesEmbeddings to an array if it's not already
        const allMessages = Array.isArray(latestMessagesEmbeddings)
          ? latestMessagesEmbeddings
          : [latestMessagesEmbeddings];

        // Sort messages by creation date, oldest first
        allMessages.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        const latestMessages = allMessages.slice(-10);
        const olderMessages = allMessages.slice(0, -10);

        const similarities = olderMessages.map((msg) => ({
          id: msg.id,
          embedding: msg.embedding.vector,
          similarity: cosineSimilarity(queryEmbedding, msg.embedding.vector),
          content: msg.content,
          role: msg.role.id,
          created_at: msg.created_at,
        }));

        // Log all similarity scores and content
        console.debug("All similarity scores and content:");
        similarities.forEach((item) => {
          console.debug(`Score: ${item.similarity}, Content: ${item.content}`);
        });

        const similarityThreshold = 0.5;
        const topSimilarities = similarities
          .filter((item) => item.similarity >= similarityThreshold)
          .sort((a, b) => b.similarity - a.similarity);

        // Log the top similarity score and content
        if (topSimilarities.length > 0) {
          const topSimilarity = topSimilarities[0];
          console.debug(`Top similarity score: ${topSimilarity.similarity}`);
          console.debug(`Top similarity content: ${topSimilarity.content}`);
        } else {
          console.debug("No messages above similarity threshold");
        }

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

        const relevantFactsText = facts
          .flat()
          .map((fact) => fact.fact_value)
          .join("\n");

        const systemPrompt = {
          role: "system",
          content: `${Session.DEFAULT_SYSTEM_MESSAGE}\n\nRelevant facts (your RAG info):\n\n${relevantFactsText}`,
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

        const messagesToSave = [
          { role: "user", content: `${userName}: ${body}` },
          responseMessage,
        ];

        session.addMessages(String(conversation.id.id), ...messagesToSave);

        console.debug("Messages: ", { ...promptMessages, responseMessage });
        console.log("Session participants: ", session.participants);

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
