import "dotenv/config";
import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import axios from "axios";
import fs from "fs";
import OpenAI from "openai";
import { typing } from "../utils/presence";

const openai = new OpenAI();
const imgurClientId = process.env?.IMGUR_CLIENT_ID;

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
				console.debug("Local file successfully deleted.");
				resolve();
			}
		});
	});
}

async function handleMedia(ctx, provider) {
	const localPath = await provider.saveFile(ctx, { path: "./assets/media" });
	console.info(localPath);

	const imageUrl = await uploadToImgur(localPath);
	console.info("Image uploaded to Imgur:", imageUrl);

	await deleteLocalFile(localPath);

	const userMessage = ctx.message.imageMessage.caption || "What's in this image?";

    console.debug(userMessage)

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
	console.debug(response.choices[0].message.content);

	typing(ctx, provider);

	const number = ctx.key.remoteJid;
	await provider.vendor.sendMessage(number, {
		text: response.choices[0].message.content,
	});

	console.info("URL of the image stored in the MongoDB database");
}

export const mediaFlow = addKeyword<Provider, Database>(EVENTS.MEDIA)
	.addAction((ctx, { provider }) =>
		handleMedia(ctx, provider).catch((error) => {
			console.error("Error handling media:", error);
		})
	);
