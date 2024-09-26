import "dotenv/config";
import Surreal, { RecordId } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import fs from "fs/promises";
import { typing } from "../utils/presence";
import sharp from "sharp";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { Session, sessions } from "../models/Session";
import { sendMessage as sendMessageService } from "../services/messageService";
import { setupLogger } from "../utils/logger";
import { getDb } from "~/database/surreal";
import { handleConversation } from "../services/conversationService";
import { getMessage } from "../services/translate";
import processSnap from "~/services/actors/snap";
import { alignResponse, uploadImageToMinio } from "~/utils/helpers";
import {
  generateHumanReadablePrompt,
  generateImageAnalysisPrompt,
  IMAGE_ANALYSIS_TYPES,
  ImageAnalysisType,
} from "~/services/promptBuilder";
import sendChatMessage, {
  ChatMessage,
  ChatMessageRole,
} from "~/services/actors/chat";
import { GenerateEmbeddings } from "~/services/actors/embeddings";
import { alertsActive } from "./alertsFlow.flow";

const queueConfig: QueueConfig = { gapSeconds: 0 };
const enqueueMessage = createMessageQueue(queueConfig);

// Constants
const CAMERA_ID = process.env.CAMERA_ID;

setupLogger();
// Image processing functions
async function processImage(localPath: string): Promise<Buffer> {
  const imageBuffer = await fs.readFile(localPath);
  return sharp(imageBuffer).jpeg({ quality: 85 }).toBuffer();
}

// Message handling functions
async function sendMessage(
  provider: Provider,
  number: string,
  text: string,
  ctx: any
): Promise<void> {
  let messageText = text;
  let mentions = [];

  if (ctx.key.participant) {
    messageText = "@" + ctx.key.participant.split("@")[0] + " " + text;
    mentions = [ctx.key.participant];
  }

  await sendMessageService(provider, number, messageText, mentions, ctx);
}

async function updateDatabaseWithModelTask(
  model_task: ImageAnalysisType,
  db: Surreal
): Promise<void> {
  const updateQuery = `
    LET $linkedTask = (SELECT (->camera_tasks.out)[0] AS task FROM $camera)[0].task;
    UPDATE $linkedTask SET model_task = $model_task;
  `;

  const query = await db.query(updateQuery, {
    model_task,
    camera: new RecordId("camera", CAMERA_ID),
  });

  console.debug("Query result:", query);
}

async function handleMedia(ctx: any, provider: Provider): Promise<void> {
  const db = getDb();
  const number = ctx.key.remoteJid;
  const userName = ctx.pushName || "System";
  const groupId = ctx.to.split("@")[0];

  try {
    await sendMessage(provider, number, getMessage("analyzing_image"), ctx);

    // Validate if the media is a sticker
    if (Object.keys(ctx.message)[0] === "stickerMessage") {
      throw {
        message: "Sorry, the sticker format is not supported for analysis",
        code: "STICKER_ERROR",
      };
    }

    const caption: string = ctx.message.imageMessage?.caption || "";

    if (!caption) {
      console.info("No caption received");
    } else {
      console.info("Received caption:", caption);
    }

    // Fetch or create the session for the group
    let session = sessions.get(groupId);
    if (!session) {
      const result = await handleConversation(groupId);
      const { conversation: conversationResult, latestMessages } =
        Array.isArray(result)
          ? { conversation: null, latestMessages: [] }
          : result;

      if (!conversationResult) {
        throw new Error("Unable to create or fetch conversation");
      }

      session = new Session(conversationResult.system_prompt);
      session.conversation = conversationResult;
      session.messages = latestMessages;
      sessions.set(groupId, session);
    }

    const analysisType = await determineAnalysisType(caption);
    if (analysisType) {
      await updateDatabaseWithModelTask(analysisType, db);
    } else {
      throw new Error("Unable to determine analysis type");
    }

    const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
    console.info("File saved at:", localPath);

    const jpegBuffer = await processImage(localPath);
    const imagePath = await uploadImageToMinio(jpegBuffer, CAMERA_ID);

    typing(ctx, provider);

    const initialData = await processSnap(imagePath, caption);

    const results = initialData.msg.analysis.results;

    const humanReadableResponse = await generateHumanReadableResponse(
      caption,
      results
    );

    const new_messages: Array<{ role: ChatMessageRole; msg: string }> = [
      { role: "user", msg: `${userName}: ${caption}` },
      { role: "tool", msg: `${results}` },
      { role: "assistant", msg: humanReadableResponse },
    ];

    // Add all messages to the session at once
    await session.addMessages(
      String(session.conversation.id.id),
      ...new_messages
    );

    enqueueMessage(ctx.body, async (_) => {
      await sendMessage(provider, number, humanReadableResponse, ctx);
    });

    console.info("Image processed and stored in MinIO and the database");

    await fs.unlink(localPath);
  } catch (error) {
    console.error("Error handling media:", error);
    const errorMessage =
      error.code !== (null || undefined)
        ? error.message
        : getMessage("analysis_error");
    await sendMessage(provider, number, errorMessage, ctx);
  }
}

// Export the flow
export const analyseImageFlow = addKeyword<Provider, Database>(
  EVENTS.MEDIA
).addAction((ctx, { provider }) => handleMedia(ctx, provider));

// Helper functions
async function determineAnalysisType(
  caption: string
): Promise<ImageAnalysisType | null> {
  const { system, prompt } = generateImageAnalysisPrompt(caption);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  const response = await sendChatMessage(messages, true);
  const analysisType = alertsActive 
  ? "caption" 
  : (response.msg.message?.content || "");
  console.debug("Chat message response (analysis type):", analysisType);

  return IMAGE_ANALYSIS_TYPES.includes(analysisType as ImageAnalysisType)
    ? (analysisType as ImageAnalysisType)
    : null;
}

async function generateHumanReadableResponse(
  caption: string,
  results: unknown
): Promise<string> {
  const { system, prompt } = generateHumanReadablePrompt(caption, results);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
    { role: "tool", content: JSON.stringify(results) },
  ];
  const response = await sendChatMessage(messages, true);
  const humanReadableResponse = response.msg.message?.content || "";
  console.info("Human-readable response:", humanReadableResponse);

  return alignResponse(humanReadableResponse);
}
