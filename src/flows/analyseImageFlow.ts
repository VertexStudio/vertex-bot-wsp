import "dotenv/config";
import { Surreal, RecordId, UUID } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs/promises";
import { typing } from "../utils/presence";
import sharp from "sharp";

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
