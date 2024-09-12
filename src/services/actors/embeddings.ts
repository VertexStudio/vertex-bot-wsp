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

async function createEmbeddings(
  texts: string[],
  model: string
): Promise<EmbeddingResult> {
  try {
    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp",
      "vertex::VertexBotWSP"
    );
    const vertexBotWsp = await bioma.createActor(vertexBotWspId);

    const embeddingsId = bioma.createActorId(
      "/embeddings",
      "embeddings::embeddings::Embeddings"
    );

    const createEmbeddingsMessage = {
      texts: texts,
      model_name: model,
    };

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      embeddingsId,
      "embeddings::embeddings::GenerateEmbeddings",
      createEmbeddingsMessage
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    return reply as EmbeddingResult;
  } catch (error) {
    console.error("Error in createEmbeddings:", error);
    throw error;
  }
}

export default createEmbeddings;
