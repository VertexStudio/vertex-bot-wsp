import "dotenv/config";
import { Surreal, RecordId, UUID } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs/promises";
import { typing } from "../utils/presence";
import sharp from "sharp";
import { callOllamaAPI } from "./welcomeFlow.flow";

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

// Constants
const {
  VV_DB_ENDPOINT,
  VV_DB_NAMESPACE,
  VV_DB_DATABASE,
  VV_DB_USERNAME,
  VV_DB_PASSWORD,
  CAMERA_ID,
} = process.env;

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

// Prompt generation functions
function generateImageAnalysisPrompt(caption: string): string {
  const prompt = `You are an AI assistant for image analysis tasks. Your role is to determine the most appropriate type of image analysis based on the user's request about an image.

  Instructions:
  1. Respond ONLY with the EXACT text label from the list below, matching the case PRECISELY. Your entire response should be a single label from this list:
    ${IMAGE_ANALYSIS_TYPES.join(", ")}

  2. Guidelines for query interpretation:
    - Text-related queries (Priority):
      • Requests about reading, understanding, or analyzing any text, numbers, or data
      • Unknown words, phrases, or symbols that need interpretation
      • Queries about documents, reports, labels, signs, or any written information
      • Questions about specific information typically presented in text (e.g., stock prices, scores, dates)
    → Use "OCR" or "OCR with region" (if a specific area is mentioned)

    - General scene queries:
      • Informal or colloquial requests about the overall image content
      • Questions about what's happening or the general context of the scene
      • Queries about identifying individuals or asking "who" questions
    → Use "more detailed caption"

    - Specific object queries:
      • Questions about identifying, counting, or locating specific objects
      • Questions about whether a certain object is present in the image
    → Use "object detection"

    - Area-specific queries (non-text):
      • Questions about particular regions or areas in the image, not related to text
    → Use "dense region caption"

  3. For ambiguous, meaningless, empty queries, or questions about identifying individuals, prefer "more detailed caption".
  4. Always interpret the request as being about the image content.
  5. Do not explain your choice or mention inability to see the image.

  CRITICAL: Your entire response must be a single label from the list, exactly as written above, including correct capitalization.

  User's text request: "${caption}"`;

  console.log("Generated prompt:", prompt);
  return prompt;
}

function generateHumanReadablePrompt(
  caption: string,
  results: unknown
): string {
  return `
  You are an AI assistant providing image analysis results. You're talking directly to the end user. The user's initial request was: "${caption}"

  The image analysis system provided the following result:
  ${results}

  CRITICAL INSTRUCTIONS:

  1. Respond ONLY with the direct answer to the user's request. Do not include any introductory or concluding remarks.
  2. If the user's initial request is empty, provide a concise description of the key elements in the image based on the analysis results.
  3. Use natural language and avoid technical jargon unless absolutely necessary.
  4. Be concise and to the point, focusing only on the information directly relevant to the user's request or the main elements of the image.
  5. If the answer to the user's request can't be determined based on the image analysis, simply state that the requested information couldn't be found in the image politely.
  6. Do not mention the image analysis process or that an analysis was performed.
  7. Do not offer further assistance or ask if the user needs more information.
  8. If the analysis results contain text from the image (OCR), use this information to answer text-related queries accurately.
  9. Format the response in a clear and easy-to-understand manner.

  CRITICAL: Your entire response should be an answer to the user's request. Do not include any additional comments or explanations about the process.
  `;
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

    const response = await callOllamaAPI(generateImageAnalysisPrompt(caption));
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

    const humanReadableResponse = await callOllamaAPI(
      generateHumanReadablePrompt(caption, JSON.stringify(results, null, 2))
    );
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
