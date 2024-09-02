import { addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { initDb } from "../database/surreal";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import * as fs from "fs";
import * as path from "path";
import { typing } from "../utils/presence";
import sharp from "sharp";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { RecordId, UUID } from "surrealdb.js";
import * as os from "os";

const RESIZED_DIRECTORY = "./assets/resized";
const MESSAGE_GAP_SECONDS = 3000;

const queueConfig: QueueConfig = { gapSeconds: MESSAGE_GAP_SECONDS };
const messageQueue = createMessageQueue(queueConfig);

interface ImageMessage {
  imagePath: string;
  timestamp: number;
  id?: string;
}
interface Snap {
  data: Uint8Array;
  format: "jpeg" | "png" | "bmp" | "gif";
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
  alertAnomaly: Record<string, string>,
  feedback: boolean[],
  waiting: boolean,
}

const imageQueue: ImageMessage[] = [];
let isProcessing = false;
let processId = 0;
let provider: Provider;
let currentCtx: any;
const sentImages: Map<string, { path: string; id: string }> = new Map();
const resizedImages: Set<string> = new Set();

const sentAlerts = new Map<string, AlertControl>();

//Listen to new anomalies
async function anomalyLiveQuery(): Promise<UUID> {
  //Live query to get the analysis of the new anomalie
  const anomalyLiveQuery = `LIVE SELECT (<-analysis[*])[0] AS analysis FROM analysis_anomalies;`;

  const db = await initDb();

  const [liveQuery] = await db.query<[UUID]>(anomalyLiveQuery);

  //Subscribe to live query to get new anomalies
  db.subscribeLive(liveQuery, async (action, result) => {
    //Get analysis and snap of the anomaly
    const analysis = result["analysis"] as {
      id: Record<string, string>;
      results: string;
    };
    const getSnapQuery =
      "(SELECT (<-snap_analysis<-snap[*])[0] AS snap FROM $analysis)[0];";

    const [getSnap] = await db.query(getSnapQuery, {
      analysis: analysis.id,
    });

    const snap = getSnap["snap"] as Snap;

    //Alert will be only sent for CREATE action
    if (action != "CREATE") return;

    //Send image to the group
    if (currentCtx && provider) {
      const messageId = await sendImage(
        currentCtx,
        provider,
        parseImageToUrlFromUint8Array(snap.data, snap.format),
        analysis.results
      );
      sentAlerts.set(messageId, { alertAnomaly: analysis.id, feedback: [], waiting: false });
    }
  });

  return liveQuery;
}

await anomalyLiveQuery();

//helper function to parse image from Uint8Array to URL
function parseImageToUrlFromUint8Array(
  data: Uint8Array,
  format: string
): string {
  const buffer = Buffer.from(data);

  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `file_${Date.now()}.${format}`);

  fs.writeFileSync(tmpFilePath, buffer);

  return tmpFilePath;
}

async function sendImage(
  ctx: any,
  provider: Provider,
  imagePath: string,
  caption?: string
): Promise<string> {
  console.log(`[${processId}] Sending image: ${imagePath}`);
  const number = ctx.key.remoteJid;
  const enhancedCaption = `🚨 Anomaly Detected 🚨\n\n${caption || path.basename(imagePath)}`;
  const sentMessage = await provider.vendor.sendMessage(number, {
    image: { url: imagePath },
    caption: enhancedCaption,
  });

  console.log(sentMessage);

  if (sentMessage && sentMessage.key && sentMessage.key.id) {
    const messageId = sentMessage.key.id;
    sentImages.set(messageId, { path: imagePath, id: messageId });
    console.log(`[${processId}] Image sent with ID: ${messageId}`);
    return messageId;
  } else {
    console.log(`[${processId}] Error: No ID found for sent message.`);
    return "";
  }
}

async function enqueueImage(
  ctx: any,
  provider: Provider,
  imagePath: string
): Promise<void> {
  console.log(`[${processId}] Enqueuing image: ${imagePath}`);
  imageQueue.push({ imagePath, timestamp: Date.now() });
  processImageQueue(ctx, provider);
}

async function processImageQueue(ctx: any, provider: Provider): Promise<void> {
  if (imageQueue.length === 0) {
    console.log(`[${processId}] Image queue is empty`);
    return;
  }

  const { imagePath } = imageQueue.shift()!;
  messageQueue(imagePath, async (body) => {
    await sendImage(ctx, provider, body, null);
  });
}

async function resizeImage(
  imagePath: string,
  width: number,
  height: number
): Promise<string> {
  console.log(`[${processId}] Resizing image: ${imagePath}`);
  if (!fs.existsSync(RESIZED_DIRECTORY)) {
    fs.mkdirSync(RESIZED_DIRECTORY);
  }
  const outputPath = path.join(RESIZED_DIRECTORY, path.basename(imagePath));

  await sharp(imagePath).resize(width, height).toFile(outputPath);

  resizedImages.add(outputPath);
  return outputPath;
}

//Handle reaction to the alert
async function handleReaction(reactions: any[]) {
  //Validate how many reaction are in the image
  if (reactions.length === 0) {
    console.log(`No reactions received.`);
    return;
  }

  //Get the first reaction
  const reaction = reactions[0];
  const { key: reactionKey, text: emoji } = reaction.reaction || {};

  //Validate the reaction format
  if (!reactionKey || !emoji) {
    console.log(`Invalid reaction format`);
    return;
  }

  //Get the ID of the reaction
  //This ID is the same as the ID of the message
  const reactionId = reaction.key;

  //Find the alert ID that matches the reaction ID
  const alertId = Array.from(sentAlerts.keys()).find(
    (alertId) => alertId == reactionId.id
  );

  //If no alert ID is found, log the error and return
  if (!alertId) {
    console.log(
      `No matching alerts found for reaction. Reaction ID: ${reactionId.id}`
    );
    console.log(`Sent alerts IDs:`, Array.from(sentAlerts.keys()));
    return;
  }

  try {
    const db = await initDb();

    //Get the analysis data of the alert by the message ID
    const alertControl = sentAlerts.get(alertId);

    //Get the analysis record of the alert
    const [analysisRecord] = await db.query<AnalysisAnomalies[]>(
      `(SELECT * FROM analysis_anomalies WHERE in = ${alertControl.alertAnomaly.tb}:${alertControl.alertAnomaly.id})[0];`
    );

    if (!analysisRecord) {
      throw new Error();
    }

    //Get the anomaly record of the analysis
    const [anomalyRecord] = await db.query<Anomaly[]>(
      `(SELECT * FROM anomaly WHERE id = ${analysisRecord.out})[0];`
    );

    if (!anomalyRecord) {
      throw new Error();
    }

    //Array of the valid reactions
    const correctEmojiList = ["✅", "👍"];
    const incorrectEmojiList = ["❌", "👎"];

    //Check if the reaction is correct or incorrect and add the respective status value to the feedback array of that alert
    //If the emoji is invalid, send a message to the user
    if (correctEmojiList.includes(emoji)) {

      alertControl.feedback.push(true);

    } else if (incorrectEmojiList.includes(emoji)) {

      alertControl.feedback.push(false);

    } else {

      await provider.sendText(
        reactionKey.remoteJid,
        `Invalid reaction. Please use one of the following reactions: ✅, 👍 or ❌, 👎`
      );

      return;

    }

    //If the alert is not waiting to process, set a timeout to process the feedback
    if (!alertControl.waiting) {

      //If not waiting, set the alert to waiting and set a timeout to process the feedback
      alertControl.waiting = true;

      setTimeout(async () => {

        let correct = 0, incorrect = 0;

        for (let i = 0; i < alertControl.feedback.length; i++) {
          alertControl.feedback[i] ? correct++ : incorrect++;
        }

        let status: boolean = null;

        if (correct > incorrect) {
          status = true;
        } else if (correct < incorrect) {
          status = false;
        }

        //Update the status of the anomaly according to the feedback
        await db.query(`UPDATE $anomaly SET status = ${status != null ? status : "None"}, timestamp = $timestamp;`, {
          anomaly: anomalyRecord.id,
          timestamp: anomalyRecord.timestamp
        });

        alertControl.waiting = false;

        console.log(`Feedback processed for alert ${alertId}. Status: ${status}`);

      }, 5 * 60 * 1000); //Set the timeout to 5 minutes
    }

    sentImages.delete(reactionId.id);

  } catch (error) {
    console.error(`[${processId}] Could not recieve feedback`, error);
    await provider.sendText(
      reactionKey.remoteJid,
      "Sorry, an error occured while processing your feedback."
    );
  }
}

export const alertsFlow = addKeyword<Provider, Database>("alertas", {
  sensitive: false,
}).addAction(async (ctx, { provider: _provider }) => {
  if (isProcessing) {
    console.log(`Attempt to execute while already processing. Ignoring.`);
    return;
  }

  isProcessing = true;
  processId = Date.now();

  try {
    typing(ctx, _provider);

    currentCtx = ctx;
    provider = _provider;

    await provider.sendText(
      ctx.key.remoteJid,
      "Alerts are now active. You will receive alerts for new anomalies."
    );

    provider.on("reaction", handleReaction);
  } catch (error) {
    console.error(`[${processId}] Error while activating alerts.`, error);
    await provider.sendText(
      ctx.key.remoteJid,
      "Sorry, an error occurred while activating alerts."
    );
  }
});

export const resizeFlow = addKeyword<Provider, Database>("resize").addAction(
  async (ctx, { provider: _provider }) => {
    const text = ctx.body.toLowerCase();
    const match = text.match(/resize (\d+)/);
    if (match) {
      const index = parseInt(match[1], 10) - 1;
      if (index >= 0 && index < sentImages.size) {
        const imagePath = Array.from(sentImages.values())[index].path;
        const resizedPath = path.join(
          RESIZED_DIRECTORY,
          path.basename(imagePath)
        );
        if (!resizedImages.has(resizedPath)) {
          await resizeImage(imagePath, 1920, 1080);
        }
        await enqueueImage(ctx, _provider, resizedPath);
      } else {
        await _provider.sendText(ctx.key.remoteJid, "Invalid image number.");
      }
    } else {
      await _provider.sendText(
        ctx.key.remoteJid,
        "Invalid command format. Use 'resize X' where X is the image number."
      );
    }
  }
);
