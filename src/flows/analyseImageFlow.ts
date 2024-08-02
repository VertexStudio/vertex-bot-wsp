import { Surreal, RecordId, UUID } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs/promises";
import { typing } from "../utils/presence";
import sharp from "sharp";
import { callOllamaChatAPI, Message } from "~/utils/ollama-api";

// Constants and Environment Variables
const {
  VV_DB_ENDPOINT,
  VV_DB_NAMESPACE,
  VV_DB_DATABASE,
  VV_DB_USERNAME,
  VV_DB_PASSWORD,
  CAMERA_ID,
} = process.env;

// Type definitions
type ImageAnalysisType =
  | "more detailed caption"
  | "object detection"
  | "dense region caption"
  | "region proposal"
  | "caption to phrase grounding"
  | "referring expression segmentation"
  | "region to segmentation"
  | "open vocabulary detection"
  | "region to category"
  | "region to description"
  | "OCR"
  | "OCR with region";

const IMAGE_ANALYSIS_TYPES: ImageAnalysisType[] = [
  "more detailed caption",
  "object detection",
  "dense region caption",
  "region proposal",
  "caption to phrase grounding",
  "referring expression segmentation",
  "region to segmentation",
  "open vocabulary detection",
  "region to category",
  "region to description",
  "OCR",
  "OCR with region",
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

// Prompt generation functions
function generateImageAnalysisPrompt(): string {
  return `You are an AI assistant for image analysis tasks. Your role is to determine the most appropriate type of image analysis available based on the user's request about an image.

  Instructions:
  1. Respond ONLY with the EXACT text label from the list below, matching the case PRECISELY. Your entire response should be a single label from this list:

    ${IMAGE_ANALYSIS_TYPES.join(", ")}.

  2. Guidelines for query interpretation:
    - Text-related queries (Priority):
      • Requests about reading, understanding, or analyzing any text, numbers, or data
      • Queries about documents, reports, labels, signs, or any written information
      • Questions about specific information typically presented in text (e.g., stock prices, scores, dates)
    → Use "OCR" or "OCR with region" (if a specific area is mentioned)

    - General scene queries:
      • Informal or colloquial requests about the overall image content
      • Questions about what's happening or the general context of the scene
    → Use "more detailed caption"

    - Specific object queries:
      • Questions about identifying, counting, or locating specific objects
    → Use "object detection"

    - Area-specific queries (non-text):
      • Questions about particular regions or areas in the image, not related to text
    → Use "dense region caption"

  3. For ambiguous queries, prefer "more detailed caption".
  4. Always interpret the request as being about the image content.
  5. Do not explain your choice or mention inability to see the image.

  CRITICAL: Your entire response must be a single label from the list, exactly as written above, including correct capitalization.`;
}

function generateHumanReadablePrompt(): string {
  return `
  You are an AI assistant interpreting image analysis results. Your ONLY task is to answer the user's question about the image based on the provided analysis.

  CRITICAL INSTRUCTIONS:
  1. ONLY use the information in the 'tool' content, which contains image analysis results.
  2. ONLY address the user's specific question about the image.
  3. DO NOT generate any content unrelated to the image analysis or the user's question.
  4. DO NOT mention or explain any code, scripts, or programming concepts.
  5. If the analysis doesn't provide enough information to answer the user's question, state this clearly and concisely.
  6. ALWAYS assume the user is asking about the image content.

  Interpretation guide:
  - 'polygons': Shapes or areas detected in the image. Each polygon is a list of [x, y] coordinates.
  - 'labels': Classifications or descriptions of detected objects/areas. Empty labels mean no specific object was identified.
  - 'width' and 'height': Dimensions of the analyzed image.

  Response structure:
  1. Directly address to the user's request based on the analysis.
  2. Acknowledgment of any limitations in answering the question based on available data.

  IMPORTANT: Before submitting your response, validate that it ONLY contains information derived from the image analysis results and directly answers the user's question. If your response includes any irrelevant information.

  Remember, you are interpreting image analysis results.
  `;
}

// Image processing functions
async function processImage(localPath: string): Promise<Buffer> {
  const imageBuffer = await fs.readFile(localPath);
  return sharp(imageBuffer).jpeg({ quality: 85 }).toBuffer();
}

async function insertImageIntoDatabase(jpegBuffer: Buffer): Promise<string> {
  const insertQuery = `
    BEGIN TRANSACTION;
    LET $new_snap = CREATE snap SET
      data = encoding::base64::decode($data),
      format = $format,
      queued_timestamp = time::now();
    RELATE $camera->camera_snaps->$new_snap;
    RETURN $new_snap;
    COMMIT TRANSACTION;
  `;

  const base64String = jpegBuffer.toString("base64").replace(/=+$/, "");

  const insertResult = await db.query(insertQuery, {
    data: base64String,
    format: "jpeg",
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
  text: string
): Promise<void> {
  await provider.vendor.sendMessage(number, { text });
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

// Main handler function
async function handleMedia(ctx: any, provider: Provider): Promise<void> {
  try {
    const number = ctx.key.remoteJid;
    await sendMessage(
      provider,
      number,
      "We're analyzing your image. Please wait..."
    );

    const caption = ctx.message.imageMessage.caption;
    console.log("Received caption:", caption);

    const systemPrompt = generateImageAnalysisPrompt();
    const response = await callOllamaChatAPI([
      { role: "system", content: systemPrompt },
      { role: "user", content: caption },
    ]);
    console.log("Ollama API response:", response);

    if (!IMAGE_ANALYSIS_TYPES.includes(response as ImageAnalysisType)) {
      await sendMessage(provider, ctx.key.remoteJid, response);
      return;
    }

    await connectToDatabase();
    await updateDatabaseWithModelTask(response as ImageAnalysisType);

    const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
    console.log("File saved at:", localPath);

    const jpegBuffer = await processImage(localPath);
    const newSnapId = await insertImageIntoDatabase(jpegBuffer);
    console.log("New snap ID:", newSnapId);

    const analysisResult = await setUpLiveQuery(newSnapId);
    console.log("Analysis query UUID:", analysisResult);

    typing(ctx, provider);

    const initialData = await waitForFirstResult(analysisResult);
    const results = initialData.results;
    console.log("Initial analysis data:", results);

    const humanReadablePrompt = generateHumanReadablePrompt();

    const params: Message[] = [
      { role: "system", content: humanReadablePrompt },
      { role: "user", content: caption },
      { role: "tool", content: JSON.stringify(results) },
    ];

    // console.log("Params for callOllamaChatAPI:", params);

    const humanReadableResponse = await callOllamaChatAPI(params);
    console.log("Human-readable response:", humanReadableResponse);

    await sendMessage(provider, number, humanReadableResponse);

    console.log("Image processed and stored in the database");

    await fs.unlink(localPath);
  } catch (error) {
    console.error("Error handling media:", error);
    const number = ctx.key.remoteJid;
    await sendMessage(
      provider,
      number,
      "Sorry, there was an issue analyzing the image. Please try again later."
    );
  }
}

// Export the flow
export const analyseImageFlow = addKeyword<Provider, Database>(
  EVENTS.MEDIA
).addAction((ctx, { provider }) => handleMedia(ctx, provider));
