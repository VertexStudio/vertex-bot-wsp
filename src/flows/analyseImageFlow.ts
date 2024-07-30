import "dotenv/config";
import { PreparedQuery, Surreal, RecordId, UUID } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { stringify as uuidStringify } from "uuid";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs";
import { typing } from "../utils/presence";
import sharp from "sharp";

let db: Surreal | undefined;

function readFileAsync(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function processUploadAndQuery(localPath: string) {
  try {
    const imageBuffer: Buffer = await readFileAsync(localPath);
    const jpegBuffer: Buffer = await sharp(imageBuffer)
      .jpeg({ quality: 85 })
      .toBuffer();

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

    const base64Data = jpegBuffer.toString("base64");

    const insertResult = await db.query(insertQuery, {
      data: base64Data,
      format: "jpeg",
      camera: new RecordId("camera", "CAM091"),
    });

    console.log("Insert result:", insertResult);

    // Extract the ID of the newly created snap
    const newSnapId = insertResult[0][0].id.id;

    console.log("New snap ID:", newSnapId);

    // Set up the live query for related analyses
    const analysisQuery = `
        LIVE SELECT 
          ->analysis.caption AS caption
        FROM snap_analysis
        WHERE in = snap:${newSnapId}
    `;

    console.log("Analysis query:", analysisQuery);

    // Start the live query
    const [analysisResult] = await db.query<[UUID]>(analysisQuery, {
      snapId: newSnapId,
    });

    console.log("Analysis result:", analysisResult);

    return analysisResult;
  } catch (error) {
    console.error("Error in process, upload, and query:", error);
  }
}

async function handleMedia(ctx, provider) {
  db = new Surreal();

  try {
    await db.connect("ws://127.0.0.1:8000/rpc", {
      namespace: "vertex",
      database: "veoveo",
      auth: {
        username: "root",
        password: "root",
      },
    });
  } catch (err) {
    console.error("Failed to connect to SurrealDB:", err);
    throw err;
  }

  const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
  console.log("File saved at:", localPath);

  const analysisResult = await processUploadAndQuery(localPath);
  console.log("Analysis query UUID:", analysisResult);

  if (!analysisResult) {
    throw new Error("Failed to process and upload the image");
  }

  typing(ctx, provider);

  // Create a promise that resolves with the first result from the live query
  const firstResultPromise = new Promise<Record<string, unknown>>((resolve) => {
    let isResolved = false;
    db.subscribeLive(analysisResult as UUID, (action, result) => {
      console.log("Live query update:", action, result);
      if (!isResolved && result && Object.keys(result).length > 0) {
        isResolved = true;
        resolve(result);
      }
    });
  });

  try {
    const initialData = await firstResultPromise;
    console.log("Initial analysis data:", initialData);

    const number = ctx.key.remoteJid;
    await provider.vendor.sendMessage(number, {
      text: `Description: ${initialData.caption || "No caption available"}`,
    });
  } catch (error) {
    console.error("Error waiting for initial data:", error);
    const number = ctx.key.remoteJid;
    await provider.vendor.sendMessage(number, {
      text: "Sorry, there was an issue analyzing the image. Please try again later.",
    });
  }

  console.log("Image processed and stored in the database");
}

export const analyseImageFlow = addKeyword<Provider, Database>(
  EVENTS.MEDIA
).addAction((ctx, { provider }) =>
  handleMedia(ctx, provider).catch((error) => {
    console.error("Error handling media:", error);
  })
);
