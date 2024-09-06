import { BiomaInterface } from "external/bioma_js/bioma.js";

const bioma = new BiomaInterface();

async function rerankTexts(query: string, texts: string[]): Promise<string[]> {
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

    const reply = await bioma.waitForReply(messageId);

    await bioma.close();

    return reply;
  } catch (error) {
    console.error("Error in rerankTexts:", error);
    throw error;
  }
}

export default rerankTexts;
