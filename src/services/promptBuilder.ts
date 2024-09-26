import { ChatMessage } from "./actors/chat";

// Type definitions
export type ImageAnalysisType =
  | "caption"
  | "more detailed caption"
  // | "object detection"
  | "dense region caption"
  // | "region proposal"
  // | "caption to phrase grounding"
  // | "referring expression segmentation"
  // | "region to segmentation"
  // | "open vocabulary detection"
  // | "region to category"
  // | "region to description"
  | "OCR"
  | "OCR with region";

export const IMAGE_ANALYSIS_TYPES: ImageAnalysisType[] = [
  "caption",
  "more detailed caption",
  // "object detection",
  "dense region caption",
  // "region proposal",
  // "caption to phrase grounding",
  // "referring expression segmentation",
  // "region to segmentation",
  // "open vocabulary detection",
  // "region to category",
  // "region to description",
  "OCR",
  // "OCR with region",
];

export function buildPromptMessages(
  systemPrompt: string,
  relevantFactsText: string,
  formattedMessages: { role: string; content: string }[],
  userName: string,
  body: string
): ChatMessage[] {
  const systemMessage = {
    role: "system",
    content: `${systemPrompt}\n\nRelevant facts (your RAG info):\n\n${relevantFactsText}`,
  };

  const userMessage = { role: "user", content: `${userName}: ${body}` };

  return [systemMessage, ...formattedMessages, userMessage] as ChatMessage[];
}

// Prompt generation functions
export function generateImageAnalysisPrompt(caption: string): {
  system: string;
  prompt: string;
} {
  const system = `You are an AI assistant for image analysis tasks. Your role is to determine the most appropriate type of image analysis based on the user's request about an image.

Instructions:
1. Respond ONLY with the EXACT text label from the list below, matching the case PRECISELY. Your entire response should be a single label from this list:
  ${IMAGE_ANALYSIS_TYPES.join(", ")}.

2. Guidelines for query interpretation:
  - Text-related queries (Use "OCR"):
    • ANY request involving reading, understanding, or analyzing text, numbers, or symbols visible in the image
    • Queries about documents, reports, labels, instructions, signs, or any written information
    • Requests to explain, clarify, or provide more information about visible text
    • Questions about specific textual content (e.g., prices, scores, dates, names)
    • Requests to translate or interpret text in the image
    • ANY query using words like "explain", "clarify", "elaborate", "describe", or "interpret" when referring to content that could be text

  - General queries and detailed descriptions (Use "more detailed caption"):
    • Requests about the overall image content, context, or scene description
    • Identifying or describing objects, people, animals, or environments
    • Questions about actions, events, or situations depicted in the image
    • Requests for detailed information about visual elements (e.g., colors, styles, arrangements)
    • Queries about recognizing familiar elements (e.g., logos, brands, famous people)
    • Any question involving visual recognition or recall without explicitly mentioning text

  - Entity(ies) location, presence, or counting (Use "dense region caption"):
    • Questions about locating specific entities (e.g., "where is the phone?")
    • Requests to count the number of particular entities (e.g., "how many apples?")
    • Queries about the presence or absence of certain entities (e.g., "is there a person?", "what's she holding?")

3. For ambiguous queries, prefer "OCR" if there's any possibility of text being involved.
4. For ambiguous queries, prefer "more detailed caption".
5. Always interpret the request as being about the image content.
6. Do not explain your choice or mention inability to see the image.
7. If the query mentions both text and general image content, prioritize "OCR".

CRITICAL: Your entire response must be a single label from the list, exactly as written above, including correct capitalization.`;

  const prompt = `User's text request: "${caption}"`;

  return { system, prompt };
}

export function generateHumanReadablePrompt(
  caption: string,
  results: unknown
): {
  system: string;
  prompt: string;
} {
  const system = `You are an AI assistant providing image analysis results directly to the end user via WhatsApp. Answer the user's request about the image based on the analysis results provided.

1. Provide a direct answer with appropriate detail. Match the complexity of your response to the query and the image analysis results. Do not include any introductory or concluding remarks.
2. Use natural language and explain technical terms if necessary.
3. If the answer can't be fully determined, acknowledge the limitation and advise to send the image again with a clearer request.
4. Don't mention the image analysis process, raw analysis results, or that an analysis was performed at all.
5. Fancy format for readability in WhatsApp chat only when necessary for complex responses.
  - Use double line breaks to separate sections, subsections, and parent lists.
  - When using bold text, use it ONLY like this: *bold text*.
6. Provide step-by-step instructions or detailed explanations when necessary.
7. If any URLs are found in the analysis results, state them as plain text.
8. Keep in mind the overall intent of the user's request.
9. Use all available information from the analysis results to answer the user's request accurately.
10. Do not offer further help or guidance.`;

  const prompt = `${caption}`;

  return { system, prompt };
}
