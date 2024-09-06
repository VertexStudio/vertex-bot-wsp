import { BiomaInterface } from "../../external/bioma_js/bioma";

interface RankTexts {
  query: string;
  texts: string[];
  raw_scores: boolean;
}

interface RankedText {
  index: number;
  score: number;
}

class RerankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RerankError";
  }
}

class Rerank {
  private bioma: BiomaInterface;
  private rerankActorId: any;

  constructor(bioma: BiomaInterface) {
    this.bioma = bioma;
    this.rerankActorId = this.bioma.createActorId("/rerank", "rerank::Rerank");
  }

  async start() {
    await this.bioma.createActor(this.rerankActorId);
    console.log(`Rerank actor started with ID: ${this.rerankActorId.id}`);
  }

  async handle(rankTexts: RankTexts): Promise<RankedText[]> {
    try {
      const dummyId = this.bioma.createActorId("/dummy", "dummy::Dummy");

      const messageId = await this.bioma.sendMessage(
        dummyId,
        this.rerankActorId,
        "rerank::RankTexts",
        rankTexts
      );

      const reply = await this.bioma.waitForReply(messageId);
      return JSON.parse(reply.msg);
    } catch (error) {
      if (error instanceof Error) {
        throw new RerankError(`Rerank error: ${error.message}`);
      }
      throw new RerankError("Unknown error occurred");
    }
  }
}

export { Rerank, RankTexts, RankedText, RerankError };
