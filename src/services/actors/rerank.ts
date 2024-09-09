import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const SURREALDB_BETA_URL = process.env.SURREALDB_BETA_URL;
const SURREALDB_BETA_NAMESPACE = process.env.SURREALDB_BETA_NAMESPACE;
const SURREALDB_BETA_DATABASE = process.env.SURREALDB_BETA_DATABASE;
const SURREALDB_BETA_USER = process.env.SURREALDB_BETA_USER;
const SURREALDB_BETA_PASSWORD = process.env.SURREALDB_BETA_PASSWORD;

const bioma = new BiomaInterface();

type RankedItem = {
  index: number;
  score: number;
};

type RerankedResult = {
  err: undefined | string;
  id: RecordId;
  msg: RankedItem[];
  name: string;
  rx: RecordId;
  tx: RecordId;
};

async function rerankTexts(
  query: string,
  texts: string[]
): Promise<RerankedResult> {
  try {
    await bioma.connect(
      SURREALDB_BETA_URL || "ws://127.0.0.1:9123",
      SURREALDB_BETA_NAMESPACE || "dev",
      SURREALDB_BETA_DATABASE || "bioma",
      SURREALDB_BETA_USER || "root",
      SURREALDB_BETA_PASSWORD || "root"
    );

    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp",
      "vertex::VertexBotWSP"
    );
    const vertexBotWsp = await bioma.createActor(vertexBotWspId);

    const rerankId = bioma.createActorId("/rerank", "rerank::rerank::Rerank");

    const rankTextsMessage = {
      query: query,
      texts: texts,
      raw_scores: false,
    };

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      rerankId,
      "rerank::rerank::RankTexts",
      rankTextsMessage
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    return reply as RerankedResult;
  } catch (error) {
    console.error("Error in rerankTexts:", error);
    throw error;
  }
}

export default rerankTexts;
