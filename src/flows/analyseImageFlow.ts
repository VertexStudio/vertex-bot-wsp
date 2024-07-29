import "dotenv/config";
import { Surreal } from "surrealdb.js";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import axios from "axios";
import fs from "fs";
import OpenAI from "openai";
import { typing } from "../utils/presence";
import sharp from "sharp";

const openai = new OpenAI();
const imgurClientId = process.env?.IMGUR_CLIENT_ID;
let db: Surreal | undefined;

async function uploadToImgur(localPath: string): Promise<string> {
  const imageData = fs.readFileSync(localPath, { encoding: "base64" });
  const imgurUploadResponse = await axios.post(
    "https://api.imgur.com/3/upload",
    { image: imageData, type: "base64" },
    { headers: { Authorization: `Client-ID ${imgurClientId}` } }
  );
  return imgurUploadResponse.data.data.link;
}

async function deleteLocalFile(localPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.unlink(localPath, (err) => {
      if (err) {
        console.error("Error deleting local file:", err);
        reject(err);
      } else {
        console.log("Local file successfully deleted.");
        resolve();
      }
    });
  });
}

function readFileAsync(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function processAndUploadImage(localPath: string) {
  try {
    // Read the file
    const imageBuffer = await readFileAsync(localPath);

    // Convert to JPEG if it's not already
    const jpegBuffer = await sharp(imageBuffer)
      .jpeg({ quality: 85 })
      .toBuffer();

    const query = `
        BEGIN TRANSACTION;
        
        LET $new_snap = CREATE snap SET 
            data = $data, 
            format = $format, 
            queued_timestamp = time::now();
  
        RELATE $camera->camera_snaps->$new_snap;
        
        RETURN $new_snap;
        
        COMMIT TRANSACTION;
      `;

    const transaction_result = await db.query(query, {
      data: jpegBuffer,
      format: "jpeg",
      camera: ["camera", "camera_whatsapp_xyz"],
    });

    console.log("Transaction result:", transaction_result);
  } catch (error) {
    console.error("Error processing and uploading image:", error);
  }
}

async function handleMedia(ctx, provider) {
  db = new Surreal();

  try {
    await db.connect("http://127.0.0.1:8000/rpc");
    await db.use({ namespace: "test", database: "test" });
  } catch (err) {
    console.error("Failed to connect to SurrealDB:", err);
    throw err;
  }

  await db.signin({
    user: "root",
    pass: "root",
  });

  await db.use({ namespace: "vertex", database: "veoveo" });

  const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
  console.log(localPath);

  await processAndUploadImage(localPath);

  const imageUrl = await uploadToImgur(localPath);
  console.log("Image uploaded to Imgur:", imageUrl);

  await deleteLocalFile(localPath);

  const userMessage =
    ctx.message.imageMessage.caption || "What's in this image?";
  3;

  console.log(userMessage);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  console.log(response.choices[0].message.content);

  typing(ctx, provider);

  const number = ctx.key.remoteJid;
  await provider.vendor.sendMessage(number, {
    text: response.choices[0].message.content,
  });

  console.log("URL of the image stored in the MongoDB database");
}

export const mediaFlow = addKeyword<Provider, Database>(EVENTS.MEDIA).addAction(
  (ctx, { provider }) =>
    handleMedia(ctx, provider).catch((error) => {
      console.error("Error handling media:", error);
    })
);
