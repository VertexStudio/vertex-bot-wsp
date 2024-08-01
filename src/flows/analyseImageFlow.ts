import "dotenv/config";
import { Surreal, RecordId, UUID } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs/promises";
import { typing } from "../utils/presence";
import sharp from "sharp";
import { callOllamaAPI } from "./welcomeFlow.flow";

let db: Surreal | undefined;

const VV_DB_ENDPOINT = process.env.VV_DB_ENDPOINT;
const VV_DB_NAMESPACE = process.env.VV_DB_NAMESPACE;
const VV_DB_DATABASE = process.env.VV_DB_DATABASE;
const VV_DB_USERNAME = process.env.VV_DB_USERNAME;
const VV_DB_PASSWORD = process.env.VV_DB_PASSWORD;

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

  let base64String = jpegBuffer.toString("base64");

  base64String = base64String.replace(/=+$/, "");

  const insertResult = await db.query(insertQuery, {
    data: base64String,
    format: "jpeg",
    camera: new RecordId("camera", "CAM001"),
  });

  return insertResult[0][0].id.id;
}

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
    db.subscribeLive(analysisResult, (action, result) => {
      console.log("Live query update:", action, result);
      if (!isResolved && result && Object.keys(result).length > 0) {
        isResolved = true;
        resolve(result);
      }
    });
  });
}

async function sendAnalysisResult(
  provider: Provider,
  number: string,
  results: string
): Promise<void> {
  await provider.vendor.sendMessage(number, {
    text: `${results || "No results available"}`,
  });
}

async function handleMedia(ctx, provider: Provider): Promise<void> {
  try {
    const caption = ctx.message.imageMessage.caption;
    const image_analysis_types = [
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
    console.log("Received caption:", caption);

    const prompt = `You are an AI assistant for image analysis tasks. An image was sent, but you can't see it. You'll receive the user's request related to the image.

Determine if the text request matches one of these image analysis types:

1. [more detailed caption]: Creating a comprehensive description of the entire image.
2. [object detection]: Identifying and locating objects within the image.
3. [dense region caption]: Generating detailed captions for multiple specific regions.
4. [region proposal]: Suggesting areas of interest within the image.
5. [caption to phrase grounding]: Linking caption phrases to specific image regions.
6. [referring expression segmentation]: Segmenting specific objects based on descriptions.
7. [region to segmentation]: Converting regions into segmentation masks or general segmentation requests.
8. [open vocabulary detection]: Detecting objects without predefined categories.
9. [region to category]: Classifying specific regions into categories.
10. [region to description]: Generating descriptions for specific image regions.
11. [OCR]: Recognizing and extracting text from the image.
12. [OCR with region]: Recognizing text and providing its location.

Instructions:
- If the request clearly matches a type, respond ONLY with the exact text label inside the square brackets, without the brackets. Do not use numbers or any other text.
- Consider variations and abbreviations of key terms (e.g., "segment", "detect", "objs").
- If the request is unclear or doesn't match any type, provide a brief, helpful response asking for clarification.
- Never mention that you can't see the image.

Examples:
- For "What objects are in this image?", respond with: object detection
- For "Segment objects in the image", respond with: region to segmentation
- For "Read the text", respond with: OCR

User's text request: "${caption}"`;

    const response = await callOllamaAPI(prompt);

    console.log("Ollama API response:", response);

    if (!image_analysis_types.includes(response)) {
      await provider.vendor.sendMessage(ctx.key.remoteJid, {
        text: response,
      });
      return;
    }

    await connectToDatabase();

    const updateQuery = `
        LET $linkedTask = (SELECT (->camera_tasks.out)[0] as task FROM camera:CAM001)[0].task;

        UPDATE $linkedTask 
        SET detection = $detection;
    `;

    await db.query(updateQuery, {
      detection: response,
    });

    const number = ctx.key.remoteJid;
    await provider.vendor.sendMessage(number, {
      text: "We're analyzing your image. Please wait...",
    });

    const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
    console.log("File saved at:", localPath);

    const jpegBuffer = await processImage(localPath);
    const newSnapId = await insertImageIntoDatabase(jpegBuffer);
    console.log("New snap ID:", newSnapId);

    const analysisResult = await setUpLiveQuery(newSnapId);
    console.log("Analysis query UUID:", analysisResult);

    typing(ctx, provider);

    const initialData = await waitForFirstResult(analysisResult);
    const results = initialData.results[0];
    console.log("Initial analysis data:", results);

    // Process the initialData to ensure it's human-readable and relevant
    const humanReadablePrompt = `
        You are an AI assistant providing image analysis results. The user's initial request was: "${caption}"
        
        The image analysis system provided the following result:
        ${results}
        
        Please provide a response that:
        1. Is easily understandable by a human
        2. Directly addresses the user's initial request ("${results}")
        3. Summarizes the key findings from the image analysis
        4. Uses natural language and avoids technical jargon unless necessary
        5. Offers to provide more details if the user needs them
        
        Your response should be concise but informative, and should not exceed 3-4 sentences.
        `;

    console.log("Human-readable prompt:", humanReadablePrompt);

    const humanReadableResponse = await callOllamaAPI(humanReadablePrompt);

    console.log("Human-readable response:", humanReadableResponse);

    await sendAnalysisResult(provider, number, humanReadableResponse);

    console.log("Image processed and stored in the database");

    await fs.unlink(localPath);
  } catch (error) {
    console.error("Error handling media:", error);
    const number = ctx.key.remoteJid;
    await provider.vendor.sendMessage(number, {
      text: "Sorry, there was an issue analyzing the image. Please try again later.",
    });
  }
}

export const analyseImageFlow = addKeyword<Provider, Database>(
  EVENTS.MEDIA
).addAction((ctx, { provider }) => handleMedia(ctx, provider));
