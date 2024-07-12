import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import OpenAI from "openai";
import fs from "fs";
import { toAsk } from "@builderbot-plugins/openai-assistants";
import { recording, typing } from "../utils/presence";
import path from "path";

const ASSISTANT_ID = process.env?.ASSISTANT_ID ?? "";
const openai = new OpenAI();
const speechFile = path.resolve("./assets/audio_bot/speech.mp3");

async function transcribeAudio(localPath) {
    return openai.audio.transcriptions.create({
        file: fs.createReadStream(localPath),
        model: "whisper-1",
    });
}

async function generateSpeech(cleanResponse) {
    const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: cleanResponse,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(speechFile, buffer);
}

async function deleteFile(filePath) {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error(`Error deleting file: ${filePath}`, err);
        } else {
            console.log(`File successfully deleted: ${filePath}`);
        }
    });
}

export const voiceNoteFlow = addKeyword<Provider, Database>(EVENTS.VOICE_NOTE)
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        try {
            const localPath = await provider.saveFile(ctx, {
                path: "./assets/audio/",
            });
            const transcription = await transcribeAudio(localPath);
            console.log("Transcription:", transcription.text);
            await typing(ctx, provider);
            const response = await toAsk(ASSISTANT_ID, transcription.text, state);
            const chunks = response.split(/(?<!\d)\.\s+/g);
            for (const chunk of chunks) {
                await flowDynamic([{ body: chunk.trim().replace(/【.*?】/g, "") }]);
            }

            const cleanResponse = response.replace(/【.*?】/g, "");
            await generateSpeech(cleanResponse);
            console.log(speechFile);

            await recording(ctx, provider);

            await deleteFile(localPath);
        } catch (error) {
            console.error("Error processing audio:", error);
        }
    })
    .addAnswer(" ", {media: speechFile})
    .addAction(async (ctx) => {
        await deleteFile(speechFile)
    })