import { minioClient } from "../services/minioClient";
//import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { TelegramProvider as Provider } from '@builderbot-plugins/telegram'
import { setupLogger } from "./logger";
import { v4 as uuidv4 } from "uuid";

setupLogger();

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

// Upload image to MinIO with specified path and name
export async function uploadImageToMinio(
  jpegBuffer: Buffer,
  cameraId: string
): Promise<string> {
  const bucketName = process.env.MINIO_BUCKET_NAME || "veoveo";
  const region = process.env.MINIO_REGION || "us-east-1";

  // Ensure the bucket exists
  const bucketExists = await minioClient.bucketExists(bucketName);
  if (!bucketExists) {
    await minioClient.makeBucket(bucketName, region);
  }

  // Generate a unique image name
  const uuid = uuidv4();
  const imageName = `frame-${uuid}.jpg`;

  // Construct the image path: output/CAMERA_ID/frame-UUID.jpg
  const imagePath = `output/${cameraId}/${imageName}`;

  // Upload the image to MinIO
  await minioClient.putObject(bucketName, imagePath, jpegBuffer);

  // Return the image path
  return imagePath;
}

export async function sendImage(
  ctx: any,
  provider: Provider,
  imageUrl: string,
  caption?: string
): Promise<string> {
  console.info(`Sending image: ${imageUrl}`);
  const number = ctx.from;
  const enhancedCaption = caption || "Image";
 
  await provider.sendMedia(number, imageUrl, enhancedCaption);

  if (ctx.messageCtx.update.message.chat.id) {
    const messageId = ctx.messageCtx.update.message.chat.id;
    console.info(`Image sent with ID: ${messageId}`);
    return messageId;
  } else {
    console.info(`Error: No ID found for sent message.`);
    return "";
  }
}

export function alignResponse(response: string): string {
  return response
    .split("\n")
    .map((line) => {
      let currentColumn = 0;
      return line.replace(/\t/g, () => {
        const spaces = 8 - (currentColumn % 8);
        currentColumn += spaces;
        return " ".repeat(spaces);
      });
    })
    .join("\n");
}
