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
      ->analysis.caption AS caption
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
  caption: string
): Promise<void> {
  await provider.vendor.sendMessage(number, {
    text: `Description: ${caption || "No caption available"}`,
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

    const prompt = `You are an AI assistant helping with image-related requests. An image was sent, but you can't see it. You'll receive the user's caption or request related to the image.
    
    First, determine if the text request matches one of these image analysis types:
    
    1. more detailed caption: Creating a more comprehensive textual description of the entire image.
    2. object detection: Identifying and locating multiple objects within the image.
    3. dense region caption: Generating detailed captions for multiple specific regions in the image.
    4. region proposal: Suggesting areas of interest within the image for further analysis.
    5. caption to phrase grounding: Linking phrases from a caption to specific regions in the image.
    6. referring expression segmentation: Segmenting specific objects in the image based on textual descriptions.
    7. region to segmentation: Converting identified regions into precise segmentation masks.
    8. open vocabulary detection: Detecting a wide range of objects without predefined categories.
    9. region to category: Classifying specific regions of the image into categories.
    10. region to description: Generating textual descriptions for specific regions of the image.
    11. OCR: Recognizing and extracting text from the image.
    12. OCR with region: Recognizing text and providing its location within the image.
    
    If the request matches one of these types, respond ONLY with the type in lowercase, using underscores for spaces.
    
    If the request doesn't clearly match any of these types or you do not have any user's text request, provide a natural, helpful response to the user. And never say you can't see the image. In this case, your response should:
    1. Acknowledge their request
    2. Explain that you can't see the image
    3. Offer assistance based on the information provided
    4. Ask for clarification if needed
    
    User's text request: "${caption}"`;

    const response = await callOllamaAPI(prompt);

    console.log("Ollama API response:", response);

    if (!image_analysis_types.includes(response)) {
      await provider.vendor.sendMessage(ctx.key.remoteJid, {
        text: response,
      });
      return;
    }

    const updateQuery = `
        LET $linkedTask = (SELECT (->camera_tasks.out)[0] as task FROM camera:CAM001)[0].task;

        UPDATE $linkedTask 
        SET detection = $detection;
    `;

    await db.query(updateQuery, {
      detection: response,
    });

    await connectToDatabase();

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
    console.log("Initial analysis data:", initialData);

    await sendAnalysisResult(provider, number, initialData.caption as string);

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
