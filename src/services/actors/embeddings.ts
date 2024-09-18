import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const VV_DB_URL = `${process.env.VV_DB_PROTOCOL}://${process.env.VV_DB_HOST}:${process.env.VV_DB_PORT}`;
const VV_DB_NAMESPACE = process.env.VV_DB_NAMESPACE;
const VV_DB_DATABASE = process.env.VV_DB_DATABASE;
const VV_DB_USER = process.env.VV_DB_USER;
const VV_DB_PASSWORD = process.env.VV_DB_PASSWORD;

const bioma = new BiomaInterface();

await bioma.connect(
  VV_DB_URL || "ws://127.0.0.1:8000",
  VV_DB_NAMESPACE || "dev",
  VV_DB_DATABASE || "bioma",
  VV_DB_USER || "root",
  VV_DB_PASSWORD || "root"
);

type EmbeddingResult = {
  err: undefined | string;
  id: RecordId;
  msg: {
    embeddings: number[][];
  };
  name: string;
  rx: RecordId;
  tx: RecordId;
};

async function createEmbeddings(
  texts: string[],
  tag: string,
  model?: string
): Promise<EmbeddingResult> {
  try {
    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp",
      "vertex::VertexBotWSP"
    );
    const vertexBotWsp = await bioma.createActor(vertexBotWspId);

    const embeddingsId = bioma.createActorId(
      "/embeddings",
      "bioma_llm::embeddings::Embeddings"
    );

    const createEmbeddingsMessage = {
      texts: texts,
      tag: tag,
    };

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      embeddingsId,
      "bioma_llm::embeddings::GenerateEmbeddings",
      createEmbeddingsMessage
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    return reply as EmbeddingResult;
  } catch (error) {
    console.error("Error in createEmbeddings:", error);
    throw error;
  }
}

type SimilarityResult = {
  err: undefined | string;
  id: RecordId;
  msg: {
    similarities: Array<{
      text: string;
      similarity: number;
    }>;
  };
  name: string;
  rx: RecordId;
  tx: RecordId;
};

async function topSimilarity(
  query: string | number[],
  tag?: string,
  k: number = 5,
  threshold: number = 0.7
): Promise<SimilarityResult> {
  try {
    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp",
      "vertex::VertexBotWSP"
    );
    const vertexBotWsp = await bioma.createActor(vertexBotWspId);

    const embeddingsId = bioma.createActorId(
      "/embeddings",
      "bioma_llm::embeddings::Embeddings"
    );

    const topKMessage = {
      query: typeof query === "string" ? { Text: query } : { Embedding: query },
      tag: tag,
      k: k,
      threshold: threshold,
    };

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      embeddingsId,
      "bioma_llm::embeddings::TopK",
      topKMessage
    );

    const reply = await bioma.waitForReply(messageId, 60000);

    return reply as SimilarityResult;
  } catch (error) {
    console.error("Error in topSimilarity:", error);
    throw error;
  }
}

export { createEmbeddings, topSimilarity };
