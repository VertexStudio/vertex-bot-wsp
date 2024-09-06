import { BiomaInterface } from "../../external/bioma_js/bioma";
import axios from "axios";

interface RankTexts {
  query: string;
  texts: string[];
  raw_scores: boolean;
}

interface RankedText {
  index: number;
  score: number;
}

class Rerank {
  private bioma: BiomaInterface;
  private url: string;
  private isRunning: boolean = false;

  constructor(url: string) {
    this.bioma = new BiomaInterface();
    this.url = url;
  }

  async connect() {
    await this.bioma.connect();
  }

  async start() {
    const actorId = this.bioma.createActorId("/rerank", "rerank::Rerank");
    await this.bioma.createActor(actorId);

    console.log(`${actorId.id} Started`);
    this.isRunning = true;

    while (this.isRunning) {
      try {
        const message = await this.bioma.waitForReply(actorId.id);
        if (message && message.name === "RankTexts") {
          const response = await this.handleRankTexts(message.msg);
          await this.bioma.sendMessage(
            actorId,
            message.tx,
            "RankedTexts",
            response
          );
        }
      } catch (error) {
        console.error(`${actorId.id} Error:`, error);
      }
    }
  }

  public async handleRankTexts(rankTexts: RankTexts): Promise<RankedText[]> {
    try {
      const response = await axios.post(this.url, rankTexts);
      if (response.status !== 200) {
        throw new Error(`Rerank response error: ${response.statusText}`);
      }
      return response.data as RankedText[];
    } catch (error) {
      console.error("Rerank request error:", error);
      throw error;
    }
  }

  public async stop() {
    this.isRunning = false;
    // Implement logic to stop the actor
  }
}

export { Rerank, RankTexts, RankedText };
