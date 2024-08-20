import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { getDb, initDb } from "../database/surreal";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import * as fs from "fs";
import * as path from "path";
import { typing } from "../utils/presence";
import * as chokidar from "chokidar";
import sharp from "sharp";
import { createMessageQueue, QueueConfig } from '../utils/fast-entires';
import { UUID } from "surrealdb.js";
import * as os from 'os';

const IMAGE_DIRECTORY = "./assets/images";
const RESIZED_DIRECTORY = "./assets/resized";
const CORRECT_DIRECTORY = "./assets/corrects";
const INCORRECT_DIRECTORY = "./assets/incorrects";
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
    format: 'jpeg' | 'png' | 'bmp' | 'gif'; // Use a union type if there are other formats
    id: Record<string, string>; // Assuming `RecordId` is a string, otherwise replace with the correct type
    queued_timestamp: Date;
}

const imageQueue: ImageMessage[] = [];
let isProcessing = false;
let processId = 0;
let provider: Provider;
let currentCtx: any;
const sentImages: Map<string, { path: string, id: string }> = new Map();
const resizedImages: Set<string> = new Set();


//Listen to new anomalies
async function anomalyLiveQuery(): Promise<UUID> {

    //Live query to get the analysis of the new anomalie
    const anomalyLiveQuery = `LIVE SELECT (<-analysis[*])[0] AS analysis FROM analysis_anomalies;`;

    const db = await initDb();

    const [liveQuery] = await db.query<[UUID]>(anomalyLiveQuery);

    //Subscribe to live query to get new anomalies
    db.subscribeLive(liveQuery,
        async (action, result) => {

            //Get analysis and snap of the anomaly
            const analysis = result['analysis'] as { id: Record<string, string>; results: string };

            const getSnapQuery = "(SELECT (<-snap_analysis<-snap[*])[0] AS snap FROM $analysis)[0];";

            const [getSnap] = await db.query(getSnapQuery, {
                analysis: analysis.id
            });

            const snap = getSnap["snap"] as Snap;

            //Alert will be only sent for CREATE action
            if (action != "CREATE") return;
            console.log("Analysis", analysis);

            //Send image to the group
            if (currentCtx && provider) {
                sendImage(currentCtx, provider, parseImageToUrlFromUint8Array(snap.data, snap.format), analysis.results);
            }

        }
    );

    return liveQuery;

}

await anomalyLiveQuery();

//helper function to parse image from Uint8Array to URL
function parseImageToUrlFromUint8Array(data: Uint8Array, format: string): string {

    const buffer = Buffer.from(data);

    const tmpDir = os.tmpdir();
    const tmpFilePath = path.join(tmpDir, `file_${Date.now()}.${format}`);

    fs.writeFileSync(tmpFilePath, buffer);

    return tmpFilePath;
}

// function getImagesOrderedByDate(directory: string): string[] {
//     console.log(`[${processId}] Getting images ordered by date`);
//     return fs.readdirSync(directory)
//         .filter(file => {
//             const ext = path.extname(file).toLowerCase();
//             return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
//         })
//         .map(file => ({
//             name: file,
//             time: fs.statSync(path.join(directory, file)).mtime.getTime()
//         }))
//         .sort((a, b) => a.time - b.time)
//         .map(file => file.name);
// }

async function sendImage(ctx: any, provider: Provider, imagePath: string, caption?: string): Promise<void> {
    console.log(`[${processId}] Sending image: ${imagePath}`);
    const number = ctx.key.remoteJid;
    const sentMessage = await provider.vendor.sendMessage(number, {
        image: { url: imagePath },
        caption: caption || path.basename(imagePath)
    });

    console.log(sentMessage);

    if (sentMessage && sentMessage.key && sentMessage.key.id) {
        const messageId = sentMessage.key.id;
        sentImages.set(messageId, { path: imagePath, id: messageId });
        console.log(`[${processId}] Image sent with ID: ${messageId}`);
    } else {
        console.log(`[${processId}] Error: No ID found for sent message.`);
    }
}

async function enqueueImage(ctx: any, provider: Provider, imagePath: string): Promise<void> {
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

// function handleNewImage(imagePath: string) {
//     console.log(`New image detected: ${imagePath}`);
//     if (currentCtx && provider) {
//         enqueueImage(currentCtx, provider, imagePath);
//     } else {
//         console.log("Cannot send image: context or provider not available");
//     }
// }

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

// const watcher = chokidar.watch(IMAGE_DIRECTORY, {
//     persistent: true
// });

// watcher
//     .on('add', (filePath: string) => {
//         const ext = path.extname(filePath).toLowerCase();
//         if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
//             handleNewImage(filePath);
//         }
//     });

async function handleReaction(reactions: any[]) {
    if (reactions.length === 0) {
        console.log(`No reactions received.`);
        return;
    }

    const reaction = reactions[0];
    const { key: reactionKey, text: emoji } = reaction.reaction || {};

    if (!reactionKey || !emoji) {
        console.log(`Invalid reaction format`);
        return;
    }

    console.log(`Reaction details:`, reaction);
    console.log(`Sent Images:`, Array.from(sentImages.entries()));

    const reactionId = reaction.key;
    console.log("ReactionID: ", reactionId.id);
    const imageMessage = Array.from(sentImages.values()).find(img => img.id === reactionId.id);
    if (!imageMessage) {
        console.log(`No matching image found for reaction. Reaction ID: ${reactionId.id}`);
        console.log(`Sent Images IDs:`, Array.from(sentImages.keys()));
        return;
    }

    const { path: imagePath } = imageMessage;
    try {
        if (emoji === "✅") {
            await provider.sendText(reactionKey.remoteJid, `Anomalia marcada como correcta.`);
        } else if (emoji === "❌") {
            await provider.sendText(reactionKey.remoteJid, `Anomalia marcada como incorrecta.`);
        }
        sentImages.delete(reactionId.id);
    } catch (error) {
        console.error(`[${processId}] Error moving image:`, error);
        await provider.sendText(reactionKey.remoteJid, "Hubo un error al mover la imagen.");
    }
}

export const alertsFlow = addKeyword<Provider, Database>("alertas", { sensitive: false })
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

            // const orderedImages = getImagesOrderedByDate(IMAGE_DIRECTORY);

            // if (orderedImages.length === 0) {
            //     console.log(`[${processId}] No images available`);
            //     await provider.sendText(ctx.key.remoteJid, "No images available. New images will be sent automatically when added.");
            //     isProcessing = false;
            //     return;
            // }

            // console.log(`[${processId}] Found ${orderedImages.length} images`);

            // for (const image of orderedImages) {
            //     const imagePath = path.join(IMAGE_DIRECTORY, image);
            //     await enqueueImage(ctx, provider, imagePath);
            // }

            await provider.sendText(ctx.key.remoteJid, "Las alertas han sido activadas.");

            if (!isProcessing) {
                // processImageQueue(ctx, provider);
            }

            provider.on("reaction", handleReaction);

        } catch (error) {
            console.error(`[${processId}] Error processing images:`, error);
            await provider.sendText(ctx.key.remoteJid, "There was an error processing the images.");
            isProcessing = false;
        }
    });

export const resizeFlow = addKeyword<Provider, Database>("resize")
    .addAction(async (ctx, { provider: _provider }) => {
        const text = ctx.body.toLowerCase();
        const match = text.match(/resize (\d+)/);
        if (match) {
            const index = parseInt(match[1], 10) - 1;
            if (index >= 0 && index < sentImages.size) {
                const imagePath = Array.from(sentImages.values())[index].path;
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

async function moveImage(imagePath: string, destinationDir: string): Promise<string> {
    console.log(`[${processId}] Moving image: ${imagePath} to ${destinationDir}`);
    const destinationPath = path.join(destinationDir, path.basename(imagePath));

    await fs.promises.rename(imagePath, destinationPath);
    return destinationPath;
}
