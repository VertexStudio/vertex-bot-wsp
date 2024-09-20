import { minioClient } from "../services/minioClient";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { setupLogger } from "./logger";

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

export async function sendImage(
  ctx: any,
  provider: Provider,
  imageUrl: string,
  caption?: string
): Promise<string> {
  console.info(`Sending image: ${imageUrl}`);
  const number = ctx.key.remoteJid;
  const enhancedCaption = caption || "Image";

  const sentMessage = await provider.vendor.sendMessage(number, {
    image: { url: imageUrl },
    caption: enhancedCaption,
  });

  if (sentMessage?.key?.id) {
    const messageId = sentMessage.key.id;
    console.info(`Image sent with ID: ${messageId}`);
    return messageId;
  } else {
    console.info(`Error: No ID found for sent message.`);
    return "";
  }
}
