import { minioClient } from "../services/minioClient";
import { initDb } from "../database/surreal";
import { getMessage } from "../services/translate";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import {
  AlertControl,
  AnalysisAnomalies,
  Anomaly,
  ImageMessage,
} from "../models/types";
import { RecordId, Uuid as UUID } from "surrealdb.js";
import { createMessageQueue, QueueConfig } from "./fast-entires";
import { setupLogger } from "./logger";

// Constants
const MESSAGE_GAP_SECONDS = 3000;
const FEEDBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Global variables
export const queueConfig: QueueConfig = { gapSeconds: MESSAGE_GAP_SECONDS };
export const messageQueue = createMessageQueue(queueConfig);
export const imageQueue: ImageMessage[] = [];
export const sentImages: Map<string, { path: string; id: string }> = new Map();
export const sentAlerts = new Map<string, AlertControl>();

export let isProcessing = false;
export let processId = 0;
export let provider: Provider;
export let currentCtx: any;

setupLogger();

// Helper functions
export async function getImageUrlFromMinio(imagePath: string): Promise<string> {
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

export async function sendImage(
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

export async function processImageQueue(
  ctx: any,
  provider: Provider
): Promise<void> {
  if (imageQueue.length === 0) {
    console.info(`[${processId}] Image queue is empty`);
    return;
  }

  const { imagePath } = imageQueue.shift()!;
  messageQueue(imagePath, async (body) => {
    await sendImage(ctx, provider, body, null);
  });
}

export async function handleReaction(reactions: any[]) {
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
