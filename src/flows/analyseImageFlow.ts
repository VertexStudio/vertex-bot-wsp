import "dotenv/config";
import { Surreal, RecordId, UUID } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs/promises";
import { typing } from "../utils/presence";
import sharp from "sharp";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { Session, sessions } from "../models/Session";
import {
  callOllamaAPI,
  getSystemPromptTokens,
  MODEL,
  ollama,
} from "../services/ollamaService";
import { sendMessage as sendMessageService } from "../services/messageService";
import { getOrCalculateSystemPromptTokens } from "../services/ollamaService";

const queueConfig: QueueConfig = { gapSeconds: 0 };
const enqueueMessage = createMessageQueue(queueConfig);

// Type definitions
type ImageAnalysisType =
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

// Constants
const {
  VV_DB_ENDPOINT,
  VV_DB_NAMESPACE,
  VV_DB_DATABASE,
  VV_DB_USERNAME,
  VV_DB_PASSWORD,
  CAMERA_ID,
} = process.env;

export const IMAGE_ANALYSIS_TYPES: ImageAnalysisType[] = [
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

// Database connection
let db: Surreal | undefined;

async function connectToDatabase(): Promise<void> {
  db = new Surreal();
  try {
    await db.connect(VV_DB_ENDPOINT, {
      namespace: VV_DB_NAMESPACE,
      database: VV_DB_DATABASE,
      auth: { username: VV_DB_USERNAME, password: VV_DB_PASSWORD },
    });
  } catch (err) {
    console.error("Failed to connect to SurrealDB:", err);
    throw err;
  }
}

// Image processing functions
async function processImage(localPath: string): Promise<Buffer> {
  const imageBuffer = await fs.readFile(localPath);
  return sharp(imageBuffer).jpeg({ quality: 85 }).toBuffer();
}

async function insertImageIntoDatabase(
  jpegBuffer: Buffer,
  caption: String
): Promise<string> {
  const insertQuery = `
    BEGIN TRANSACTION;
    LET $new_snap = CREATE snap SET
      data = encoding::base64::decode($data),
      format = $format,
      caption = $caption,
      queued_timestamp = time::now();
    RELATE $camera->camera_snaps->$new_snap;
    RETURN $new_snap;
    COMMIT TRANSACTION;
  `;

  const base64String = jpegBuffer.toString("base64").replace(/=+$/, "");

  const insertResult = await db.query(insertQuery, {
    data: base64String,
    format: "jpeg",
    ...(caption.trim() !== "" ? { caption } : {}),
    camera: new RecordId("camera", CAMERA_ID),
  });

  return insertResult[0][0].id.id;
}

// Analysis functions
async function setUpLiveQuery(snapId: string): Promise<UUID> {
  const analysisQuery = `
    LIVE SELECT 
      ->analysis.results AS results
    FROM snap_analysis
    WHERE in = snap:${snapId}
  `;

  const [analysisResult] = await db.query<[UUID]>(analysisQuery, { snapId });
  return analysisResult;
}

function waitForFirstResult(
  analysisResult: UUID
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let isResolved = false;
    db.subscribeLive<Record<string, unknown>>(
      analysisResult,
      (action, result) => {
        console.log("Live query update:", action, result);
        if (
          !isResolved &&
          result &&
          "results" in result &&
          Array.isArray(result.results) &&
          result.results.length > 0
        ) {
          isResolved = true;
          resolve(result);
        }
      }
    );
  });
}

// Message handling functions
async function sendMessage(
  provider: Provider,
  number: string,
  text: string,
  ctx: any
): Promise<void> {
  let messageText = text;
  let mentions = [];

  if (ctx.key.participant) {
    messageText = "@" + ctx.key.participant.split("@")[0] + " " + text;
    mentions = [ctx.key.participant];
  }

  await sendMessageService(provider, number, messageText, mentions, ctx);
}

async function updateDatabaseWithModelTask(
  model_task: ImageAnalysisType
): Promise<void> {
  const updateQuery = `
    LET $linkedModelTask = (SELECT (->camera_tasks->task->task_model_tasks.out)[0] AS model_task FROM $camera)[0].model_task;
    UPDATE $linkedModelTask SET task = $model_task;
  `;

  const query = await db.query(updateQuery, {
    model_task,
    camera: new RecordId("camera", CAMERA_ID),
  });

  console.log("Query result:", query);
}

// Prompt generation functions
function generateImageAnalysisPrompt(
  caption: string,
  userName: string
): {
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
      • Questions about locating specific entities (eg. "where is the phone?")
      • Requests to count the number of particular entities (eg. "how many apples?")
      • Queries about the presence or absence of certain entities (eg. "is there a person?", "what's she holding?")

  3. For ambiguous queries, prefer "OCR" if there's any possibility of text being involved.
  4. For ambiogous queries, prefer "more detailed caption".
  5. Always interpret the request as being about the image content.
  6. Do not explain your choice or mention inability to see the image.
  7. If the query mentions both text and general image content, prioritize "OCR".
  8. The format of the user's request is: "[user_name]: [caption]".
  9. Pay attention only to the caption part of the request.

  CRITICAL: Your entire response must be a single label from the list, exactly as written above, including correct capitalization.`;

  const prompt = `${userName}: ${caption}`;

  return { system, prompt };
}

const ANALYSE_RESULTS_SYSTEM_PROMPT = `You are an AI assistant providing image analysis results directly to the end user via WhatsApp. Answer the user's request about the image based on the analysis results provided by the tool.

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

async function handleMedia(ctx: any, provider: Provider): Promise<void> {
  const number = ctx.key.remoteJid;
  const userName = ctx.pushName || "System";
  try {
    await sendMessage(
      provider,
      number,
      `We're analyzing your image. Please wait...`,
      ctx
    );

    const caption = ctx.message.imageMessage.caption;

    if (!caption) {
      console.log("No caption received");
    } else {
      console.log("Received caption:", caption);
    }

    // Get or create a session for this user
    if (!sessions.has(number)) {
      sessions.set(number, new Session());
    }
    const session = sessions.get(number)!;

    await connectToDatabase();
    const { system: analysisSystem, prompt: analysisPrompt } =
      generateImageAnalysisPrompt(caption, userName);

    // Get system prompt tokens for image analysis (cached)
    const analysisSystemTokens = await getOrCalculateSystemPromptTokens(
      analysisSystem
    );

    const analysisType = await callOllamaAPI(analysisPrompt, {
      system: analysisSystem,
      temperature: 0,
      top_k: 20,
      top_p: 0.45,
    });

    await updateDatabaseWithModelTask(
      analysisType.response as ImageAnalysisType
    );

    const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
    console.log("File saved at:", localPath);

    const jpegBuffer = await processImage(localPath);
    const newSnapId = await insertImageIntoDatabase(jpegBuffer, caption);
    console.log("New snap ID:", newSnapId);

    const analysisResult = await setUpLiveQuery(newSnapId);
    console.log("Analysis query UUID:", analysisResult);

    typing(ctx, provider);

    const initialData = await waitForFirstResult(analysisResult);
    const results = initialData.results;
    console.log("Initial analysis data:", results);

    // Get system prompt tokens for human readable response (cached)
    const humanReadableSystemTokens = await getSystemPromptTokens(
      ANALYSE_RESULTS_SYSTEM_PROMPT
    );
    console.debug("Human readable system tokens:", humanReadableSystemTokens);

    const humanReadableResult = await ollama.chat({
      model: MODEL,
      messages: [
        { role: "system", content: ANALYSE_RESULTS_SYSTEM_PROMPT },
        { role: "user", content: analysisPrompt },
        { role: "tool", content: results[0] },
      ],
      options: {
        temperature: 0.1,
        top_k: 20,
        top_p: 0.45,
      },
    });
    console.debug("Human readable result:", humanReadableResult);

    const userMessageTokens = analysisType.promptTokens - analysisSystemTokens;
    const toolMessageTokens =
      humanReadableResult.prompt_eval_count -
      (humanReadableSystemTokens + userMessageTokens);
    const assistantMessageTokens = humanReadableResult.eval_count;

    // Add user, tool, and assistant messages to the session all at once
    session.addMessage([
      {
        role: "user",
        content: `${userName}: ${caption}`,
        tokens: userMessageTokens,
      },
      {
        role: "tool",
        content: `${results[0]}`,
        tokens: toolMessageTokens,
      },
      {
        role: "assistant",
        content: humanReadableResult.message.content,
        tokens: assistantMessageTokens,
      },
    ]);

    // Update the last prompt eval count
    session.updateLastPromptEvalCount(humanReadableResult.prompt_eval_count);

    // Log session messages
    console.log(
      "*****************************************************************"
    );
    console.log("Session messages: ", session.messages);
    console.log(
      "*****************************************************************"
    );

    enqueueMessage(ctx.body, async (_) => {
      await sendMessage(
        provider,
        number,
        humanReadableResult.message.content,
        ctx
      );
    });

    console.log("Image processed and stored in the database");

    await fs.unlink(localPath);
  } catch (error) {
    console.error("Error handling media:", error);
    await sendMessage(
      provider,
      number,
      "Sorry, there was an issue analyzing the image. Please try again later.",
      ctx
    );
  }
}

// Export the flow
export const analyseImageFlow = addKeyword<Provider, Database>(
  EVENTS.MEDIA
).addAction((ctx, { provider }) => handleMedia(ctx, provider));

// Helper functions
// async function determineAnalysisType(caption: string): Promise<{
//   response: ImageAnalysisType;
//   promptTokens: number;
//   totalPromptEvalCount: number;
// }> {
//   const { system, prompt } = generateImageAnalysisPrompt(caption, userName);
//   const result = await callOllamaAPI(prompt, {
//     system,
//     temperature: 0,
//     top_k: 20,
//     top_p: 0.45,
//   });
//   console.log("Ollama API response (analysis type):", result.response);

//   return {
//     response: IMAGE_ANALYSIS_TYPES.includes(
//       result.response as ImageAnalysisType
//     )
//       ? (result.response as ImageAnalysisType)
//       : null,
//     promptTokens: result.promptTokens,
//     totalPromptEvalCount: result.totalPromptEvalCount,
//   };
// }

// async function generateHumanReadableResponse(
//   caption: string,
//   results: unknown
// ): Promise<{
//   response: string;
//   promptTokens: number;
//   responseTokens: number;
//   totalPromptEvalCount: number;
// }> {
//   const { system, prompt } = generateHumanReadablePrompt(caption, results);
//   const result = await callOllamaAPI(prompt, {
//     system,
//     temperature: 0.1,
//     top_k: 20,
//     top_p: 0.45,
//   });
//   console.debug("Human-readable response:", result.response);

//   return {
//     response: alignResponse(result.response),
//     promptTokens: result.promptTokens,
//     responseTokens: result.responseTokens,
//     totalPromptEvalCount: result.totalPromptEvalCount,
//   };
// }

function alignResponse(response: string): string {
  return response
    .split("\n")
    .map((line) => {
      let currentColumn = 0;
      return line.replace(/\t/g, () => {
        const spaces = 8 - (currentColumn % 8);
        currentColumn += spaces;
        return " ".repeat(spaces);
      });
    })
    .join("\n");
}
