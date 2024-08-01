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

// const IMAGE_ANALYSIS_DESCRIPTIONS = `
// more detailed caption: Creating comprehensive and detailed textual descriptions of the entire image. This involves identifying all significant elements within the image, describing their appearances, relationships, actions, interactions, and the overall context. For example, providing a narrative that includes objects, scenery, people, and their activities.

// object detection: Locating and identifying specific objects within an image. This includes providing bounding boxes and labels for each detected object. For example, identifying a cat, a car, and a tree within the image, along with their respective positions.

// dense region caption: Generating detailed textual descriptions for multiple specific regions within an image, especially in densely populated scenes. Each caption should describe what is present in the corresponding region, including objects and their actions. For example, describing different areas in a crowded market scene.

// region proposal: Identifying and suggesting regions of interest within an image that might contain important objects or details. This involves pinpointing areas that warrant further analysis or attention, such as highlighting potential areas where objects or activities are concentrated.

// caption to phrase grounding: Associating specific phrases from a provided caption to particular regions in an image. This involves linking parts of the text description with corresponding visual regions. For example, linking the phrase "a man riding a bicycle" to the region in the image that contains the man and the bicycle.

// referring expression segmentation: Segmenting and identifying specific objects in the image based on descriptive phrases provided by the user. This involves using the user's description to find and isolate the specified object within the image. For instance, segmenting the object described as "the red car on the left" based on that description.

// region to segmentation: Converting selected regions into segmentation masks, which involves creating precise outlines or masks for the identified regions. This can be used for further image analysis tasks, such as isolating objects or areas for detailed study.

// open vocabulary detection: Detecting and identifying objects within an image using a flexible and extensive vocabulary, not limited to predefined categories. This involves recognizing and naming objects that may not be part of a standard object detection dataset, allowing for a more flexible approach.

// region to category: Classifying specific regions into predefined categories or types based on their content. This involves analyzing the selected region and assigning it to a known category, such as "animal", "vehicle", or "building". For example, categorizing different sections of a park scene into playground, bench area, and walking path.

// region to description: Generating detailed descriptions for specific regions within the image, explaining what each part contains. This involves providing a narrative or explanation for what is seen in the region, including objects, activities, and context. For example, describing the activities happening in a section of a beach scene.

// OCR: Detecting and recognizing all text present within the image. This involves identifying areas containing text, extracting the text, and converting it into a digital format that can be read and processed. For example, recognizing and transcribing a signboard in the image.

// OCR with region: Detecting and recognizing text within an image and providing information about its location. This involves not only extracting the text but also specifying where each piece of text is located within the image. For example, identifying and locating text on multiple signs within a street view image.
// `;

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
    LET $linkedTask = (SELECT (->camera_tasks.out)[0] as task FROM $camera)[0].task;
    UPDATE $linkedTask SET model_task = $model_task;
  `;

  const query = await db.query(updateQuery, {
    model_task,
    camera: new RecordId("camera", CAMERA_ID),
  });

  console.log("Query result:", query);
}

// Prompt generation functions
function generateImageAnalysisPrompt(caption: string): string {
  const prompt = `You are an AI assistant for image analysis tasks. Although you can't see the image, you will receive user requests related to it. Your task is to determine the most appropriate type of image analysis or computer vision task based on the user's request.

  Instructions:
  - Choose the most appropriate image analysis type from the following list matching their exact case: ${IMAGE_ANALYSIS_TYPES.join(
    ", "
  )}
  - If the request clearly matches a type, respond ONLY with the exact text label as it appears in the list above, including matching the case exactly. Do not add any additional text or explanation.
  - Consider variations and abbreviations of key terms in the user's request.
  - Always assume the user's text request is about the image, even if it doesn't make sense to you.
  - Never mention that you can't see the image.

  User's text request: "${caption}"`;

  console.debug("Generated prompt:", prompt);

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

  Please provide a response that:
  1. Is easily understandable by a human.
  2. Directly addresses the user's initial request: "${caption}".
  3. Summarizes the key findings from the image analysis.
  4. Uses natural language and avoids technical jargon unless absolutely necessary.
  5. Is concise but informative, ensuring the user receives the essential information they need.
  6. Directly answer the user's text request without additional information or comments.
  7. Do not ever deny the user's request or suggest that you can't help.
  8. Be concise and to the point, focusing on the key information the user needs.

  Structure your response to clearly convey the image analysis results in a helpful and straightforward way, directly relating to the user's initial request. Do not offer further assistance or additional comments.
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
      generateHumanReadablePrompt(caption, results)
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
