import { Session } from "../models/Session";
import { topSimilarity } from "../services/actors/embeddings";
import rerankTexts from "~/services/actors/rerank";
import { Message } from "../models/types";

export function processQuotedMessage(
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

export async function getRelevantMessages(
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

export async function getRelevantFacts(body: string): Promise<string> {
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