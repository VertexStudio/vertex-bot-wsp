import { addKeyword, MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { RecordId, Uuid as UUID } from "surrealdb.js";
import { Client as MinioClient } from "minio";
import { initDb } from "../database/surreal";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { setupLogger } from "../utils/logger";
import { getMessage } from "../services/translate";

// Constants
const MESSAGE_GAP_SECONDS = 3000;
const FEEDBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Interfaces
interface ImageMessage {
  imagePath: string;
  timestamp: number;
  id?: string;
}

interface Snap {
  image_path: string;
  id: Record<string, string>;
  queued_timestamp: Date;
}

interface AnalysisAnomalies {
  out: RecordId;
  in: RecordId;
  status: boolean;
}

interface Anomaly {
  id: RecordId;
  timestamp: Date;
}

interface AlertControl {
  alertAnomaly: Record<string, string>;
  feedback: boolean[];
  waiting: boolean;
}

// Global variables
const queueConfig: QueueConfig = { gapSeconds: MESSAGE_GAP_SECONDS };
const messageQueue = createMessageQueue(queueConfig);
const imageQueue: ImageMessage[] = [];
const sentImages: Map<string, { path: string; id: string }> = new Map();
const sentAlerts = new Map<string, AlertControl>();

let isProcessing = false;
let processId = 0;
let provider: Provider;
let currentCtx: any;

setupLogger();

// MinIO client initialization
const minioClient = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD,
  region: process.env.MINIO_REGION,
});

// Helper functions
async function getImageUrlFromMinio(imagePath: string): Promise<string> {
  try {
    const bucketName = process.env.MINIO_BUCKET_NAME || "veoveo";
    const expiryTime = 24 * 60 * 60;

    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, process.env.MINIO_REGION);
    }

    return await minioClient.presignedGetObject(
      bucketName,
      imagePath,
      expiryTime
    );
  } catch (error) {
    console.error("Error getting image URL from MinIO:", error);
    throw error;
  }
}

async function sendImage(
  ctx: any,
  provider: Provider,
  imageUrl: string,
  caption?: string
): Promise<string> {
  console.info(`[${processId}] Sending image: ${imageUrl}`);
  const number = ctx.key.remoteJid;
  const enhancedCaption = `🚨 Anomaly Detected 🚨\n\n${caption || "Image"}`;

  const sentMessage = await provider.vendor.sendMessage(number, {
    image: { url: imageUrl },
    caption: enhancedCaption,
  });

  if (sentMessage?.key?.id) {
    const messageId = sentMessage.key.id;
    sentImages.set(messageId, { path: imageUrl, id: messageId });
    console.info(`[${processId}] Image sent with ID: ${messageId}`);
    return messageId;
  } else {
    console.info(`[${processId}] Error: No ID found for sent message.`);
    return "";
  }
}

async function processImageQueue(ctx: any, provider: Provider): Promise<void> {
  if (imageQueue.length === 0) {
    console.info(`[${processId}] Image queue is empty`);
    return;
  }

  const { imagePath } = imageQueue.shift()!;
  messageQueue(imagePath, async (body) => {
    await sendImage(ctx, provider, body, null);
  });
}

async function handleReaction(reactions: any[]) {
  if (reactions.length === 0) return;

  const reaction = reactions[0];
  const { key: reactionKey, text: emoji } = reaction.reaction || {};

  if (!reactionKey || !emoji) {
    console.info(`Invalid reaction format`);
    return;
  }

  const reactionId = reaction.key;
  const alertId = Array.from(sentAlerts.keys()).find(
    (alertId) => alertId == reactionId.id
  );

  if (!alertId) {
    console.info(
      `No matching alerts found for reaction. Reaction ID: ${reactionId.id}`
    );
    return;
  }

  try {
    const db = await initDb();
    const alertControl = sentAlerts.get(alertId);

    const [analysisRecord] = await db.query<AnalysisAnomalies[]>(
      `(SELECT * FROM analysis_anomalies WHERE in = ${alertControl.alertAnomaly.tb}:${alertControl.alertAnomaly.id})[0];`
    );

    if (!analysisRecord) throw new Error("Analysis record not found");

    const [anomalyRecord] = await db.query<Anomaly[]>(
      `(SELECT * FROM anomaly WHERE id = ${analysisRecord.out})[0];`
    );

    if (!anomalyRecord) throw new Error("Anomaly record not found");

    const correctEmojiList = ["✅", "👍"];
    const incorrectEmojiList = ["❌", "👎"];

    if (correctEmojiList.includes(emoji)) {
      alertControl.feedback.push(true);
    } else if (incorrectEmojiList.includes(emoji)) {
      alertControl.feedback.push(false);
    } else {
      await provider.sendText(
        reactionKey.remoteJid,
        getMessage("invalid_reaction")
      );
      return;
    }

    if (!alertControl.waiting) {
      alertControl.waiting = true;
      setTimeout(
        () => processFeedback(db, alertControl, anomalyRecord, alertId),
        FEEDBACK_TIMEOUT
      );
    }

    sentImages.delete(reactionId.id);
  } catch (error) {
    console.error(`[${processId}] Could not receive feedback`, error);
    await provider.sendText(
      reactionKey.remoteJid,
      "Sorry, an error occurred while processing your feedback."
    );
  }
}

async function processFeedback(
  db: any,
  alertControl: AlertControl,
  anomalyRecord: Anomaly,
  alertId: string
) {
  const { correct, incorrect } = alertControl.feedback.reduce(
    (acc, feedback) => {
      feedback ? acc.correct++ : acc.incorrect++;
      return acc;
    },
    { correct: 0, incorrect: 0 }
  );

  let status: boolean | null = null;
  if (correct > incorrect) status = true;
  else if (correct < incorrect) status = false;

  await db.query(
    `UPDATE $anomaly SET status = ${
      status != null ? status : "None"
    }, timestamp = $timestamp;`,
    {
      anomaly: anomalyRecord.id,
      timestamp: anomalyRecord.timestamp,
    }
  );

  alertControl.waiting = false;
  console.info(`Feedback processed for alert ${alertId}. Status: ${status}`);
}

// Main function
async function anomalyLiveQuery(): Promise<UUID> {
  const anomalyLiveQuery = `LIVE SELECT (<-analysis[*])[0] AS analysis FROM analysis_anomalies;`;
  const db = await initDb();
  const [liveQuery] = await db.query<[UUID]>(anomalyLiveQuery);

  db.subscribeLive(liveQuery, async (action, result) => {
    if (action !== "CREATE") return;

    const analysis = result["analysis"] as {
      id: Record<string, string>;
      results: string;
    };
    const [getSnap] = await db.query(
      "(SELECT (<-snap_analysis<-snap[*])[0] AS snap FROM $analysis)[0];",
      { analysis: analysis.id }
    );

    const snap = getSnap["snap"] as Snap;

    if (currentCtx && provider) {
      const imageUrl = await getImageUrlFromMinio(snap.image_path);
      const messageId = await sendImage(
        currentCtx,
        provider,
        imageUrl,
        analysis.results
      );
      sentAlerts.set(messageId, {
        alertAnomaly: analysis.id,
        feedback: [],
        waiting: false,
      });
    }
  });

  return liveQuery;
}

// Main flow
export const alertsFlow = addKeyword<Provider, Database>("alertas", {
  sensitive: false,
}).addAction(async (ctx, { provider: _provider }) => {
  if (isProcessing) {
    console.debug(`Attempt to execute while already processing. Ignoring.`);
    return;
  }

  isProcessing = true;
  processId = Date.now();

  try {
    typing(ctx, _provider);
    currentCtx = ctx;
    provider = _provider;

    await provider.sendText(ctx.key.remoteJid, getMessage("alerts_on"));
    provider.on("reaction", handleReaction);
    await anomalyLiveQuery();
  } catch (error) {
    console.error(`[${processId}] Error while activating alerts.`, error);
    await provider.sendText(ctx.key.remoteJid, getMessage("alerts_error"));
  }
});
