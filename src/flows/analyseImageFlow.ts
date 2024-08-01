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

    const prompt = `You are an AI assistant specializing in image analysis tasks. An image has been sent, but you cannot directly view it. Your role is to analyze the user's text request related to the image and categorize it based on specific image analysis types.

    Carefully examine the user's text request and determine if it matches one of these image analysis types:

    1. [more detailed caption]: Request for a comprehensive description of the entire image.
    2. [object detection]: Request to identify and locate multiple objects within the image.
    3. [dense region caption]: Request for detailed captions of multiple specific regions in the image.
    4. [region proposal]: Request for suggestions of interesting areas within the image for further analysis.
    5. [caption to phrase grounding]: Request to link caption phrases to specific image regions.
    6. [referring expression segmentation]: Request to segment specific objects based on textual descriptions.
    7. [region to segmentation]: Request to convert identified regions into precise segmentation masks.
    8. [open vocabulary detection]: Request to detect a wide range of objects without predefined categories.
    9. [region to category]: Request to classify specific image regions into categories.
    10. [region to description]: Request for textual descriptions of specific image regions.
    11. [OCR]: Request to recognize and extract text from the image, including queries about specific words or text.
    12. [OCR with region]: Request to recognize text and provide its location within the image.

    Instructions:
    - If the user's request clearly and unambiguously matches one of these types, respond ONLY with the exact type label, without brackets and maintaining the exact capitalization. Do not include any additional text.
    - Pay special attention to requests about text or specific words in the image. These should be categorized as [OCR] or [OCR with region] depending on whether location information is requested.
    - If the request is ambiguous, unclear, nonsensical, or could potentially match multiple types, do NOT attempt to categorize it. Instead, respond with a message that:
      1. Acknowledges the input
      2. Explains that the request is unclear or doesn't match any specific image analysis task
      3. Asks for clarification or provides examples of clear requests
    - If there is no user text request provided, ask for a request to be made.

    Remember, never mention that you can't see the image. Always assume the image is present and respond accordingly.

    Examples of clear categorization:
    - "What objects are in this image?" -> object detection
    - "Is the word 'Hello' in this image?" -> OCR
    - "Describe the entire scene in detail." -> more detailed caption
    - "Where is the logo located in this image?" -> OCR with region

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
