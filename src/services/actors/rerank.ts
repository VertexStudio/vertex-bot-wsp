// import { Rerank, RankTexts, RankedText } from "../../actors/rerank";

// export class RerankService {
//   private reranker: Rerank;

//   constructor(rerankerUrl: string) {
//     this.reranker = new Rerank(rerankerUrl);
//   }

//   async initialize(): Promise<void> {
//     await this.reranker.connect();
//     await this.reranker.start();
//     // Wait a bit to ensure the reranker is ready
//     await new Promise((resolve) => setTimeout(resolve, 1000));
//   }

//   async rankTexts(query: string, texts: string[]): Promise<RankedText[]> {
//     const rankTextsRequest: RankTexts = {
//       query,
//       texts,
//       raw_scores: false,
//     };

//     return await this.reranker.handleRankTexts(rankTextsRequest);
//   }

//   async stop(): Promise<void> {
//     // Assuming you've implemented a stop method in the Rerank class
//     await this.reranker.stop();
//   }
// }

// // Export a function to create and initialize the service
// export async function createRerankService(
//   rerankerUrl: string
// ): Promise<RerankService> {
//   const service = new RerankService(rerankerUrl);
//   await service.initialize();
//   return service;
// }
