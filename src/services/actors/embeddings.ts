import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const BIOMA_DB_URL = `${process.env.BIOMA_DB_PROTOCOL}://${process.env.BIOMA_DB_HOST}:${process.env.BIOMA_DB_PORT}`;
const BIOMA_DB_NAMESPACE = process.env.BIOMA_DB_NAMESPACE;
const BIOMA_DB_DATABASE = process.env.BIOMA_DB_DATABASE;
const BIOMA_DB_USER = process.env.BIOMA_DB_USER;
const BIOMA_DB_PASSWORD = process.env.BIOMA_DB_PASSWORD;

const bioma = new BiomaInterface();

await bioma.connect(
  BIOMA_DB_URL || "ws://127.0.0.1:8000",
  BIOMA_DB_NAMESPACE || "dev",
  BIOMA_DB_DATABASE || "bioma",
  BIOMA_DB_USER || "root",
  BIOMA_DB_PASSWORD || "root"
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

export type GenerateEmbeddings = {
  source: string;
  texts: string[];
  metadata?: Record<string, any>[];
  tag: string;
};

async function createEmbeddings(
  embeddings_req: GenerateEmbeddings
): Promise<EmbeddingResult> {
  try {
    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp-embeddings",
      "vertex::VertexBotWSP"
    );
    const vertexBotWsp = await bioma.createActor(vertexBotWspId);

    const embeddingsId = bioma.createActorId(
      "/embeddings",
      "bioma_llm::embeddings::Embeddings"
    );

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      embeddingsId,
      "bioma_llm::embeddings::GenerateEmbeddings",
      embeddings_req
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    return reply as EmbeddingResult;
  } catch (error) {
    console.error("Error in createEmbeddings:", error);
    throw error;
  }
}

type Similarity = {
  text: string;
  similarity: number;
  metadata?: Record<string, any>;
};

type SimilarityResult = {
  err: undefined | string;
  id: RecordId;
  msg: Similarity[];
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
      "/vertex-bot-wsp-embeddings",
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
