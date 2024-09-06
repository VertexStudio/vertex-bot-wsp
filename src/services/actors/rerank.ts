import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";

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
    await bioma.connect();

    const bridgeId = bioma.createActorId("/bridge", "BridgeActor");
    const bridgeActor = await bioma.createActor(bridgeId);

    const rerankId = bioma.createActorId(
      "/rerank",
      "bioma_rerank::rerank::Rerank"
    );

    const rankTextsMessage = {
      query: query,
      texts: texts,
      raw_scores: false,
    };

    const messageId = await bioma.sendMessage(
      bridgeId,
      rerankId,
      "bioma_rerank::rerank::RankTexts",
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
