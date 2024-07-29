import "dotenv/config";
import { Surreal } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs";
import { typing } from "../utils/presence";
import sharp from "sharp";

let db: Surreal | undefined;

interface SnapResult {
  id: string;
  [key: string]: unknown;
}

type QueryResult = [{ result: SnapResult[] }];

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
    const jpegBytes = new Uint8Array(jpegBuffer);

    const insertQuery = `
        BEGIN TRANSACTION;

        LET $camera = type::thing("camera", $camera);
        
        LET $new_snap = CREATE snap SET 
            data = $data, 
            format = $format, 
            queued_timestamp = time::now();
  
        RELATE $camera->camera_snaps->$new_snap;
        
        RETURN $new_snap;
        
        COMMIT TRANSACTION;
      `;

    const insertResult = await db.query<QueryResult>(insertQuery, {
      data: jpegBytes,
      format: "jpeg",
      camera: ["camera", "CAM001"],
    });

    console.log("Insert result:", insertResult);

    // Extract the ID of the newly created snap
    const newSnapId = insertResult[0].result[0].id;

    // Set up the live query for related analyses
    const liveQuery = `
        LIVE SELECT analysis.* FROM snap_analysis
        RELATE ${newSnapId}->snap_analysis->analysis
        FETCH analysis.*;
      `;

    // Start the live query
    const unsubscribe = await db.live<Record<string, unknown>>(
      liveQuery,
      (action, result) => {
        console.log("Live query update:", action, result);
        // Handle the live query data here
      }
    );

    console.log("Live query started for snap:", newSnapId);

    // You might want to store the unsubscribe function to stop the live query later
    return unsubscribe;
  } catch (error) {
    console.error("Error in process, upload, and query:", error);
  }
}

async function handleMedia(ctx, provider) {
  db = new Surreal();

  try {
    // await db.signin({ user: "root", pass: "root" });
    // await db.use({ namespace: "vertex", database: "veoveo" });
    await db.connect("http://127.0.0.1:8000/rpc", {
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
  console.log(localPath);

  await processUploadAndQuery(localPath);

  typing(ctx, provider);

  const number = ctx.key.remoteJid;
  await provider.vendor.sendMessage(number, {
    text: "Live query response",
  });

  console.log("URL of the image stored in the MongoDB database");
}

export const analyseImageFlow = addKeyword<Provider, Database>(
  EVENTS.MEDIA
).addAction((ctx, { provider }) =>
  handleMedia(ctx, provider).catch((error) => {
    console.error("Error handling media:", error);
  })
);
