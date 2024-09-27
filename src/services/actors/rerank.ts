import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const BIOMA_DB_URL = `${process.env.BIOMA_DB_PROTOCOL}://${process.env.BIOMA_DB_HOST}:${process.env.BIOMA_DB_PORT}`;
const BIOMA_DB_NAMESPACE = process.env.BIOMA_DB_NAMESPACE;
const BIOMA_DB_DATABASE = process.env.BIOMA_DB_DATABASE;
const BIOMA_DB_USER = process.env.BIOMA_DB_USER;
const BIOMA_DB_PASSWORD = process.env.BIOMA_DB_PASSWORD;

const bioma = new BiomaInterface();

type RankTexts = {
  query: string;
  texts: string[];
};

type RankedTexts = {
  index: number;
  score: number;
};

type RerankedResult = {
  err: undefined | string;
  id: RecordId;
  msg: RankedTexts[];
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
      BIOMA_DB_URL || "ws://127.0.0.1:8000",
      BIOMA_DB_NAMESPACE || "dev",
      BIOMA_DB_DATABASE || "bioma",
      BIOMA_DB_USER || "root",
      BIOMA_DB_PASSWORD || "root"
    );

    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp-rerank",
      "vertex::VertexBotWSP"
    );
    const vertexBotWsp = await bioma.createActor(vertexBotWspId);

    const rerankId = bioma.createActorId(
      "/rerank",
      "bioma_llm::rerank::Rerank"
    );

    const rankTextsMessage: RankTexts = {
      query: query,
      texts: texts,
    };

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      rerankId,
      "bioma_llm::rerank::RankTexts",
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
