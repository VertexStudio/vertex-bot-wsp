import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const SURREALDB_BETA_URL = process.env.SURREALDB_BETA_URL;
const SURREALDB_BETA_NAMESPACE = process.env.SURREALDB_BETA_NAMESPACE;
const SURREALDB_BETA_DATABASE = process.env.SURREALDB_BETA_DATABASE;
const SURREALDB_BETA_USER = process.env.SURREALDB_BETA_USER;
const SURREALDB_BETA_PASSWORD = process.env.SURREALDB_BETA_PASSWORD;

const bioma = new BiomaInterface();

type EmbeddingResult = {
  err: undefined | string;
  id: RecordId;
  msg: number[][];
  name: string;
  rx: RecordId;
  tx: RecordId;
};

async function createEmbeddings(text: string): Promise<EmbeddingResult> {
  try {
    await bioma.connect(
      SURREALDB_BETA_URL || "ws://127.0.0.1:9123",
      SURREALDB_BETA_NAMESPACE || "dev",
      SURREALDB_BETA_DATABASE || "bioma",
      SURREALDB_BETA_USER || "root",
      SURREALDB_BETA_PASSWORD || "root"
    );

    const bridgeId = bioma.createActorId("/bridge", "BridgeActor");
    const bridgeActor = await bioma.createActor(bridgeId);

    const embeddingsId = bioma.createActorId(
      "/embeddings",
      "embeddings::embeddings::Embeddings"
    );

    const createEmbeddingsMessage = {
      text: text,
    };

    const messageId = await bioma.sendMessage(
      bridgeId,
      embeddingsId,
      "embeddings::embeddings::CreateEmbeddings",
      createEmbeddingsMessage
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    console.debug("reply: ", reply);

    return reply as EmbeddingResult;
  } catch (error) {
    console.error("Error in createEmbeddings:", error);
    throw error;
  }
}

export default createEmbeddings;
