import "dotenv/config";
import { PreparedQuery, Surreal, RecordId } from "surrealdb.js";
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
      camera: new RecordId("camera", "CAM090"),
    });

    console.log("Insert result:", insertResult);

    // Extract the ID of the newly created snap
    const newSnapId = insertResult[0][0].id;

    console.log("New snap ID:", newSnapId);

    // Set up the live query for related analyses
    const analysisQuery = `
        LIVE SELECT 
          ->analysis.caption AS caption
        FROM snap_analysis
        WHERE in = $snapId;
      `;

    console.log("Analysis query:", analysisQuery);

    // Start the live query
    const [analysisResult] = await db.query<[string]>(
      `LIVE SELECT ->analysis.caption AS caption FROM snap_analysis WHERE snap:1;`
    );

    console.log("Analysis result:", analysisResult);

    // You might want to store the unsubscribe function to stop the live query later
    return analysisResult;
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
