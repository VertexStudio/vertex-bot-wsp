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
const CAMERA_ID = process.env.CAMERA_ID;

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
    camera: new RecordId("camera", CAMERA_ID),
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

    const prompt = `You are an AI assistant for image analysis tasks. Although you can't see the image, you will receive user requests related to it. Your task is to determine if the user's request matches one of the specified image analysis types.

    Image Analysis Types:
    more detailed caption: Crafting a comprehensive and detailed description of the entire image. This involves identifying all significant elements, their relationships, and the overall context. For example, describing not just objects but their actions, interactions, and settings.

    object detection: Identifying and locating specific objects within the image. This includes naming each object and possibly providing coordinates or bounding boxes for their locations. For instance, recognizing a cat, a car, and a tree within the image.

    dense region caption: Generating detailed captions for multiple specific regions within the image. Each caption should describe what is present in the corresponding region in a detailed manner. For example, providing separate captions for different areas of a busy street scene.

    region proposal: Suggesting areas of interest within the image that might contain important objects or details. This involves identifying regions that warrant further analysis or attention, such as highlighting potential areas where objects or activities are concentrated.

    caption to phrase grounding: Linking specific phrases from a provided caption to particular regions in the image. This involves associating parts of the text description with the corresponding visual regions. For example, linking "a man riding a bicycle" to the region in the image containing the man and the bicycle.

    referring expression segmentation: Segmenting and identifying specific objects in the image based on descriptive phrases provided by the user. This involves using the user's description to find and isolate the specified object within the image. For instance, segmenting "the red car on the left" based on that description.

    region to segmentation: Converting selected regions into segmentation masks or addressing general requests to segment parts of the image. This involves creating precise outlines or masks for the identified regions, often used for further image analysis tasks.

    open vocabulary detection: Detecting and identifying objects within the image without being limited to predefined categories. This involves recognizing and naming objects that may not be part of a standard object detection dataset, thus requiring a more flexible approach.

    region to category: Classifying specific regions into predefined categories or types based on their content. This involves analyzing the selected region and assigning it to a known category, such as "animal", "vehicle", or "building".

    region to description: Generating detailed descriptions for specific regions within the image, explaining what each part contains. This involves providing a narrative or explanation for what is seen in the region, often including details about objects, activities, and context.

    OCR: Recognizing and extracting all text present within the image. This involves identifying areas containing text and converting them into a digital format that can be read and processed.

    OCR with region: Recognizing text and providing its location within specific regions of the image. This involves not only extracting the text but also specifying where each piece of text is located within the image.

    Instructions:
    If the request clearly matches a type, respond ONLY with the exact text label without the brackets. Do not use numbers or any other text.
    Consider variations and abbreviations of key terms (e.g., "segment", "detect", "objs").
    If the request is unclear or doesn't match any type, provide a brief, helpful response asking for clarification.
    Never mention that you can't see the image.

    Examples:
    For "What objects are in this image?", respond with: object detection
    For "Segment objects in the image", respond with: region to segmentation
    For "Read the text", respond with: OCR
    For "Describe this area in detail", respond with: region to description
    For "Identify objects without a list", respond with: open vocabulary detection

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
        LET $linkedTask = (SELECT (->camera_tasks.out)[0] as task FROM $camera)[0].task;

        UPDATE $linkedTask 
        SET detection = $detection;
    `;

    await db.query(updateQuery, {
      detection: response,
      camera: new RecordId("camera", CAMERA_ID),
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
    You are an AI assistant providing image analysis results. You're talking directly to the end user. The user's initial request was: "${caption}"

    The image analysis system provided the following result:
    ${results}

    Please provide a response that:
    1. Is easily understandable by a human.
    2. Directly addresses the user's initial request: "${caption}".
    3. Summarizes the key findings from the image analysis.
    4. Uses natural language and avoids technical jargon unless absolutely necessary.
    5. Is concise but informative, ensuring the user receives the essential information they need.

    Structure your response to clearly convey the image analysis results in a helpful and straightforward way, directly relating to the user's initial request.
    `;

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
