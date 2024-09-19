import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { callOllamaAPIChat } from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";
import { setupLogger } from "../utils/logger";
import Surreal, { RecordId } from "surrealdb.js";
import { getDb } from "~/database/surreal";
import { getMessage } from "../services/translate";
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

type Message = {
  msg: string;
  created_at: string;
  id: RecordId;
  role: RecordId;
};

export async function handleConversation(groupId: string): Promise<{
  latestMessagesEmbeddings: Message[];
  conversation: Conversation;
}> {
  const db = getDb();

  const conversation = await getOrCreateConversation(db, groupId);

  const latestMessagesEmbeddings = await getConversationMessages(db, groupId);

  return { latestMessagesEmbeddings, conversation };
}

async function getOrCreateConversation(
  db: Surreal,
  groupId: string
): Promise<Conversation> {
  const [result] = await db.query<Conversation[]>(`
    SELECT * FROM conversation WHERE whatsapp_id = '${groupId}'
  `);
  let conversation: Conversation | null =
    Array.isArray(result) && result.length > 0 ? result[0] : null;

  if (!conversation) {
    const [createResult] = await db.query<Conversation[]>(
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
    conversation = createResult[0];
  }

  return conversation;
}

async function getConversationMessages(
  db: Surreal,
  groupId: string
): Promise<Message[]> {
  const [result] = await db.query<Message[]>(`
    SELECT 
        *,
        (->chat_message_role.out)[0] AS role
    FROM (
        SELECT ->conversation_chat_messages->chat_message AS chat_message 
        FROM conversation 
        WHERE whatsapp_id = '${groupId}'
    )[0].chat_message 
    ORDER BY created_at 
    LIMIT 30;
  `);
  return Array.isArray(result) ? result : [];
}

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

        await sendResponse(provider, ctx, response.content);
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

function processQuotedMessage(
  ctx: any,
  session: Session,
  userNumber: string,
  userName: string,
  body: string
): string {
  const quotedMessage =
    ctx.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quotedMessage) {
    const quotedText =
      quotedMessage.extendedTextMessage?.text || quotedMessage.conversation;

    if (quotedText) {
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
        `${quotedParticipantName}: ${quotedText}`
      );
      const quotes = session.getQuotesByUser(userNumber);
      body = `quotes: ${quotes} User ${userName} prompt: ${body}`;
    }
  }
  return body;
}

async function getRelevantMessages(
  body: string,
  allMessages: Message[]
): Promise<{ role: string; content: string }[]> {
  const messages = Array.isArray(allMessages) ? allMessages : [allMessages];

  messages.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const latestMessages = messages.slice(-10);
  const olderMessages = messages.slice(0, -10);

  const similarityResult = await topSimilarity(body, "conversation", 20, 0.5);

  let topSimilarities: Array<{
    role: string;
    content: string;
    similarity: number;
  }> = [];

  if (similarityResult.msg && Array.isArray(similarityResult.msg)) {
    topSimilarities = similarityResult.msg
      .map((sim) => {
        const matchingMessage = olderMessages.find(
          (msg) => msg.msg === sim.text
        );
        return matchingMessage
          ? {
              role: String(matchingMessage.role?.id || matchingMessage.role),
              content: sim.text,
              similarity: sim.similarity,
            }
          : null;
      })
      .filter(Boolean) as Array<{
      role: string;
      content: string;
      similarity: number;
    }>;
  }

  if (topSimilarities.length > 0) {
    const topSimilarityMsg = topSimilarities[0];
    console.debug(`Top similarity score: ${topSimilarityMsg.similarity}`);
    console.debug(`Top similarity content: ${topSimilarityMsg.content}`);
  } else {
    console.debug("No messages above similarity threshold");
  }

  const messagesToRerank = topSimilarities.map(({ content }) => content);

  let rerankedOlderMessages: Array<{
    role: string;
    content: string;
    score: number;
  }> = [];

  if (messagesToRerank.length > 0) {
    const rerankedMessagesResult = await rerankTexts(body, messagesToRerank);

    if (rerankedMessagesResult && Array.isArray(rerankedMessagesResult.msg)) {
      rerankedOlderMessages = rerankedMessagesResult.msg
        .map((item) => {
          const message = messagesToRerank[item.index];
          const originalMessage = topSimilarities.find(
            (msg) => msg.content === message
          );
          return {
            role: originalMessage?.role || "unknown",
            content: message,
            score: item.score,
          };
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, 10);
    } else {
      console.warn(
        "Unexpected rerankedMessagesResult format:",
        rerankedMessagesResult
      );
    }
  }

  const formattedMessages = [
    ...rerankedOlderMessages.map(({ role, content }) => ({
      role,
      content,
    })),
    ...latestMessages.map((msg) => ({
      role: String(msg.role?.id || msg.role),
      content: msg.msg,
    })),
  ];

  return formattedMessages;
}

async function getRelevantFacts(body: string): Promise<string> {
  let rerankedFacts: string[] = [];

  const factSimilarityResult = await topSimilarity(body, "facts", 20, 0.5);

  let topSimilarFacts: Array<{
    content: string;
    similarity: number;
  }> = [];

  if (
    factSimilarityResult.msg &&
    Array.isArray(factSimilarityResult.msg) &&
    factSimilarityResult.msg.length > 0
  ) {
    topSimilarFacts = factSimilarityResult.msg.map((sim) => ({
      content: sim.text,
      similarity: sim.similarity,
    }));

    const topSimilarityFact = topSimilarFacts[0];
    console.debug(`Top fact similarity score: ${topSimilarityFact.similarity}`);
    console.debug(`Top fact similarity content: ${topSimilarityFact.content}`);

    const factsToRerank = topSimilarFacts.map(({ content }) => content);

    const rerankedFactsResult = await rerankTexts(body, factsToRerank);

    if (rerankedFactsResult && Array.isArray(rerankedFactsResult.msg)) {
      rerankedFacts = rerankedFactsResult.msg
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((item) => factsToRerank[item.index]);
    } else {
      console.warn(
        "Unexpected rerankedFactsResult format:",
        rerankedFactsResult
      );
    }
  } else {
    console.debug("No facts above similarity threshold");
  }

  return rerankedFacts.length > 0 ? rerankedFacts.join("\n") : "";
}

function buildPromptMessages(
  systemPrompt: string,
  relevantFactsText: string,
  formattedMessages: { role: string; content: string }[],
  userName: string,
  body: string
): { role: string; content: string }[] {
  const systemMessage = {
    role: "system",
    content: `${systemPrompt}\n\nRelevant facts (your RAG info):\n\n${relevantFactsText}`,
  };

  const userMessage = { role: "user", content: `${userName}: ${body}` };

  return [systemMessage, ...formattedMessages, userMessage];
}

async function sendResponse(provider: any, ctx: any, content: string) {
  let messageText = content;
  let mentions: string[] = [];

  if (ctx.key.participant) {
    messageText = `@${ctx.key.participant.split("@")[0]} ${messageText}`;
    mentions = [ctx.key.participant];
  }

  await sendMessage(provider, ctx.key.remoteJid, messageText, mentions, ctx);
}
