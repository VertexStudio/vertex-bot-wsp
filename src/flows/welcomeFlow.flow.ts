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
import { RecordId } from "surrealdb.js";
import { getDb } from "~/database/surreal";
import { cosineSimilarity } from "../utils/vectorUtils";
import { getMessage } from "../services/translate";
import { facts } from "~/app";
import rerankTexts from "~/services/actors/rerank";
import { topSimilarity } from "../services/actors/embeddings";

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

setupLogger();

type Conversation = {
  id: RecordId;
  whatsapp_id: string;
  system_prompt: string;
};

type EmbeddingData = {
  id: RecordId;
  vector: number[];
};

type Message = {
  msg: string;
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
    const [result] = await db.query<Conversation[]>(
      `
      CREATE conversation SET 
        id = crypto::sha256("whatsapp//${groupId}"),
        whatsapp_id = '${groupId}',
        system_prompt = $system_prompt
    `,
      {
        system_prompt: Session.DEFAULT_SYSTEM_MESSAGE,
      }
    );
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
    try {
      await typing(ctx, provider);

      const groupId = ctx.to.split("@")[0];
      const userId = ctx.key.remoteJid;
      const userName = ctx.pushName || "User";
      const userNumber = ctx.key.participant || ctx.key.remoteJid;

      // TODO: Get conversation only once.
      const result = await handleConversation(groupId);
      const { latestMessagesEmbeddings, conversation } = Array.isArray(result)
        ? { latestMessagesEmbeddings: [], conversation: null }
        : result;

      if (!sessions.has(userId)) {
        sessions.set(userId, new Session(conversation.system_prompt));
      }
      const session = sessions.get(userId)!;

      session.addParticipant(userNumber, userName);

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

        // Use topSimilarity function
        const similarityResult = await topSimilarity(body, undefined, 10, 0.5);

        let topSimilarities: Array<{
          role: string;
          content: string;
          similarity: number;
        }> = [];

        if (similarityResult.msg && similarityResult.msg.similarities) {
          topSimilarities = similarityResult.msg.similarities
            .map((sim) => {
              const matchingMessage = olderMessages.find(
                (msg) => msg.msg === sim.text
              );
              return matchingMessage
                ? {
                    role: String(
                      matchingMessage.role?.id || matchingMessage.role
                    ),
                    content: sim.text,
                    similarity: sim.similarity,
                  }
                : null;
            })
            .filter(Boolean);
        }

        // Log the top similarity score and content
        if (topSimilarities.length > 0) {
          const topSimilarity = topSimilarities[0];
          console.debug(`Top similarity score: ${topSimilarity.similarity}`);
          console.debug(`Top similarity content: ${topSimilarity.content}`);
        } else {
          console.debug("No messages above similarity threshold");
        }

        // Rerank messages
        const messagesToRerank = [
          ...topSimilarities.map(({ content }) => content),
          ...latestMessages.map((msg) => msg.msg),
        ];

        const rerankedMessagesResult = await rerankTexts(
          body,
          messagesToRerank
        );

        let rerankedMessages: Array<{
          role: string;
          content: string;
          score: number;
        }> = [];

        if (
          rerankedMessagesResult &&
          Array.isArray(rerankedMessagesResult.msg)
        ) {
          rerankedMessages = rerankedMessagesResult.msg
            .sort((a, b) => b.score - a.score)
            .map((item) => {
              const message = messagesToRerank[item.index];
              const originalMessage = [
                ...topSimilarities,
                ...latestMessages,
              ].find((msg) => msg.content === message || msg.msg === message);
              return {
                role: String(originalMessage.role?.id || originalMessage.role),
                content: message,
                score: item.score,
              };
            });
        } else {
          console.warn(
            "Unexpected rerankedMessagesResult format:",
            rerankedMessagesResult
          );
        }

        const formattedMessages = rerankedMessages.map(({ role, content }) => ({
          role,
          content,
        }));

        let rerankedFacts: string[] = [];

        const factValues = facts
          .flatMap((fact) =>
            Array.isArray(fact)
              ? fact.map((f) => f.fact_value)
              : [fact.fact_value]
          )
          .filter(Boolean);

        if (factValues.length > 0) {
          // Use topSimilarity for facts
          const factSimilarityResult = await topSimilarity(
            body,
            undefined,
            10,
            0.5
          );

          let topSimilarFacts: Array<{
            content: string;
            similarity: number;
          }> = [];

          if (
            factSimilarityResult.msg &&
            factSimilarityResult.msg.similarities
          ) {
            topSimilarFacts = factSimilarityResult.msg.similarities.map(
              (sim) => ({
                content: sim.text,
                similarity: sim.similarity,
              })
            );
          }

          // Log the top similarity score and content for facts
          if (topSimilarFacts.length > 0) {
            const topSimilarityFact = topSimilarFacts[0];
            console.debug(
              `Top fact similarity score: ${topSimilarityFact.similarity}`
            );
            console.debug(
              `Top fact similarity content: ${topSimilarityFact.content}`
            );
          } else {
            console.debug("No facts above similarity threshold");
          }

          // Rerank the top similar facts
          const factsToRerank = topSimilarFacts.map(({ content }) => content);
          const rerankedFactsResult = await rerankTexts(body, factsToRerank);

          if (rerankedFactsResult && Array.isArray(rerankedFactsResult.msg)) {
            // Sort the reranked facts by score in descending order
            rerankedFacts = rerankedFactsResult.msg
              .sort((a, b) => b.score - a.score)
              .map((item) => factsToRerank[item.index])
              .slice(0, 5); // Take the top 5 reranked facts
          } else {
            console.warn(
              "Unexpected rerankedFactsResult format:",
              rerankedFactsResult
            );
          }
        }

        const relevantFactsText =
          rerankedFacts.length > 0 ? rerankedFacts.join("\n") : "";

        const systemPrompt = {
          role: "system",
          content: `${conversation.system_prompt}\n\nRelevant facts (your RAG info):\n\n${relevantFactsText}`,
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

        await session.addMessages(
          String(conversation.id.id),
          ...messagesToSave
        );

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
        getMessage(`errorWelcome ${error.message}`)
      );
    }
  }
);
