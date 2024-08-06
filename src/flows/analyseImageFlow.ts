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
  // "dense region caption",
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
  const prompt = `You are an AI assistant for image analysis tasks. Determine the most appropriate type of image analysis based on the user's request about an image.

  Instructions:
  1. Respond ONLY with the EXACT text label from this list, matching the case PRECISELY:
    ${IMAGE_ANALYSIS_TYPES.join(", ")}

  2. Use these simple guidelines:
    - "OCR": For ANY query related to text.
    - "object detection": ONLY for queries about specific entities within the image, counting, locate, check presence, etc.
    - "more detailed caption": For ALL OTHER queries.

  3. Your entire response must be a single label from the list above.
  4. Do not explain your choice or mention inability to see the image.
  5. ALWAYS interpret the request as being about the image and its contents. EVERYTHING is about the image and what is IN the image.
  6. Pay attention to the overall intent of the user's request with respect to the image.
  7. If the user tells you about entities, subjects, objects etc, is talking about things in the image.

  User's text request: "${caption}"`;

  console.log("Generated prompt:", prompt);
  return prompt;
}

function generateHumanReadablePrompt(
  caption: string,
  results: unknown
): string {
  const prompt = `
You are an AI assistant providing image analysis results. You are talking directly to the end user. The user's initial request was: "${caption}"

The image analysis system provided the following result:
${results}

CRITICAL INSTRUCTIONS:

1. Provide a response that directly answers the user's request. The level of detail should match the complexity of the query. Do not include any introductory or concluding remarks.
2. For simple questions, give brief, concise answers without unnecessary elaboration.
3. For more complex queries or requests for further explanation, provide detailed information, breaking down concepts as needed.
4. Use natural language and explain any technical terms if they must be used.
5. If the answer can't be fully determined from the image analysis, provide relevant information and acknowledge any limitations.
6. Do not mention the image analysis process or that an analysis was performed.
7. Use OCR results accurately for text-related queries.
8. Format for WhatsApp chat ONLY when necessary for complex responses:
   - Use asterisks for bullet points (e.g., * Item 1\\n* Item 2\\n* Item 3)
   - Use emojis sparingly
   - Use line breaks (\\n) for spacing
   - Use single asterisks for bold (e.g., *important text*). AVOID double asterisks.
   - For nested lists, use dashes (-) and indent.
   - For subitems, first add indentation relative to the parent item (at least 8 spaces per level), then add dashes, then add text.
   - Use double line breaks for separating sections.
9. Provide step-by-step instructions or detailed explanations only when explicitly requested or necessary for understanding.
10. Use all available information from the analysis results to answer the user's request accurately.
11. For complex topics, break down the information into digestible parts.

CRITICAL: Your response should directly answer the user's request ("${caption}"), with appropriate detail and formatting. Use complex formatting only when the query demands it. For simple queries, provide straightforward answers without unnecessary formatting or explanations.
`;

  console.log("Generated prompt:", prompt);
  return prompt;
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
