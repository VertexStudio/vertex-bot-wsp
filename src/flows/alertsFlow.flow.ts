import { addKeyword, MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { initDb } from "../database/surreal";
import { getMessage } from "../services/translate";
import { Uuid as UUID } from "surrealdb.js";
import {
  Snap,
  AnalysisAnomalies,
  Anomaly,
  AlertControl,
} from "../models/types";
import { getImageUrlFromMinio } from "../utils/helpers";
import { sendImage } from "../utils/helpers";
import { typing } from "../utils/presence";
import { setupLogger } from "../utils/logger";
import { sendResponse } from "../services/responseService";

setupLogger();

let isProcessing = false;
let processId = 0;
let provider: Provider;
let currentCtx: any;
const sentAlerts = new Map<string, AlertControl>();
const FEEDBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

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
    isProcessing = false;
  }
});

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
      const anomalyCaption = "🚨 Anomaly Detected 🚨\n\n" + analysis.results;
      const messageId = await sendImage(
        currentCtx,
        provider,
        imageUrl,
        anomalyCaption
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

  let statusEmoji = "";
  if (status === true) {
    statusEmoji = "✅";
  } else if (status === false) {
    statusEmoji = "❌";
  } else {
    statusEmoji = "❓";
  }

  alertControl.waiting = false;
  console.info(`Feedback processed for alert ${alertId}. Status: ${status}`);

  try {
    await sendResponse(
      provider,
      currentCtx,
      `Feedback processed for alert ${alertId}. Status: ${statusEmoji} ${status}`
    );
  } catch (error) {
    console.error("Error sending feedback message:", error);
  }
}
