import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import * as fs from "fs";
import * as path from "path";
import { typing } from "../utils/presence";
import * as chokidar from "chokidar";
import sharp from "sharp";

const IMAGE_DIRECTORY = "./assets/images";
const RESIZED_DIRECTORY = "./assets/resized";
const MESSAGE_GAP_SECONDS = 6000;

interface ImageMessage {
    imagePath: string;
    timestamp: number;
}

const imageQueue: ImageMessage[] = [];
let imageTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let processId = 0;
let provider: Provider;
let currentCtx: any;
const sentImages: string[] = [];
const resizedImages: Set<string> = new Set();

function getImagesOrderedByDate(directory: string): string[] {
    console.log(`[${processId}] Getting images ordered by date`);
    return fs.readdirSync(directory)
        .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
        })
        .map(file => ({
            name: file,
            time: fs.statSync(path.join(directory, file)).mtime.getTime()
        }))
        .sort((a, b) => a.time - b.time)
        .map(file => file.name);
}

async function sendImage(ctx: any, provider: Provider, imagePath: string) {
    console.log(`[${processId}] Sending image: ${imagePath}`);
    const number = ctx.key.remoteJid;
    await provider.vendor.sendMessage(number, {
        image: { url: imagePath },
        caption: path.basename(imagePath)
    });
    sentImages.push(imagePath);
}

async function enqueueImage(ctx: any, provider: Provider, imagePath: string): Promise<void> {
    console.log(`[${processId}] Enqueuing image: ${imagePath}`);
    imageQueue.push({ imagePath, timestamp: Date.now() });

    if (!imageTimer) {
        imageTimer = setTimeout(() => processImageQueue(ctx, provider), MESSAGE_GAP_SECONDS);
    }
}

async function processImageQueue(ctx: any, provider: Provider): Promise<void> {
    if (imageQueue.length === 0) {
        console.log(`[${processId}] Image queue is empty`);
        imageTimer = null;
        isProcessing = false;
        return;
    }

    const { imagePath } = imageQueue.shift()!;
    await sendImage(ctx, provider, imagePath);

    imageTimer = setTimeout(() => processImageQueue(ctx, provider), MESSAGE_GAP_SECONDS);
}

function handleNewImage(imagePath: string) {
    console.log(`New image detected: ${imagePath}`);
    if (currentCtx && provider) {
        enqueueImage(currentCtx, provider, imagePath);
    } else {
        console.log("Cannot send image: context or provider not available");
    }
}

async function resizeImage(imagePath: string, width: number, height: number): Promise<string> {
    console.log(`[${processId}] Resizing image: ${imagePath}`);
    if (!fs.existsSync(RESIZED_DIRECTORY)) {
        fs.mkdirSync(RESIZED_DIRECTORY);
    }
    const outputPath = path.join(RESIZED_DIRECTORY, path.basename(imagePath));

    await sharp(imagePath)
        .resize(width, height)
        .toFile(outputPath);

    resizedImages.add(outputPath);
    return outputPath;
}

const watcher = chokidar.watch(IMAGE_DIRECTORY, {
    persistent: true
});

watcher
    .on('add', (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            handleNewImage(filePath);
        }
    });

export const imageFlow = addKeyword<Provider, Database>("imagenes", {sensitive: false})
    .addAction(async (ctx, { provider: _provider }) => {
        if (isProcessing) {
            console.log(`Attempt to execute while already processing. Ignoring.`);
            return;
        }

        isProcessing = true;
        processId = Date.now();
        console.log(`[${processId}] Starting image processing`);

        try {
            typing(ctx, _provider);

            currentCtx = ctx;
            provider = _provider;

            const orderedImages = getImagesOrderedByDate(IMAGE_DIRECTORY);

            if (orderedImages.length === 0) {
                console.log(`[${processId}] No images available`);
                await provider.sendText(ctx.key.remoteJid, "No images available. New images will be sent automatically when added.");
                isProcessing = false;
                return;
            }

            console.log(`[${processId}] Found ${orderedImages.length} images`);

            for (const image of orderedImages) {
                const imagePath = path.join(IMAGE_DIRECTORY, image);
                await enqueueImage(ctx, provider, imagePath);
            }

            await provider.sendText(ctx.key.remoteJid, "All images have been enqueued and will be sent shortly. New images will be sent automatically.");

            if (!imageTimer) {
                processImageQueue(ctx, provider);
            }
        } catch (error) {
            console.error(`[${processId}] Error processing images:`, error);
            await provider.sendText(ctx.key.remoteJid, "There was an error processing the images.");
            isProcessing = false;
            imageTimer = null;
        }
    });

export const resizeFlow = addKeyword<Provider, Database>("resize")
    .addAction(async (ctx, { provider: _provider }) => {
        const text = ctx.body.toLowerCase();
        const match = text.match(/resize (\d+)/);
        if (match) {
            const index = parseInt(match[1], 10) - 1;
            if (index >= 0 && index < sentImages.length) {
                const imagePath = sentImages[index];
                const resizedPath = path.join(RESIZED_DIRECTORY, path.basename(imagePath));
                if (!resizedImages.has(resizedPath)) {
                    await resizeImage(imagePath, 1920, 1080);
                }
                await enqueueImage(ctx, _provider, resizedPath);
            } else {
                await _provider.sendText(ctx.key.remoteJid, "Invalid image number.");
            }
        } else {
            await _provider.sendText(ctx.key.remoteJid, "Invalid command format. Use 'resize X' where X is the image number.");
        }
    });
