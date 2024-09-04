import "dotenv/config";
import {
	createBot,
	createProvider,
} from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { httpInject } from "@builderbot-plugins/openai-assistants";
import { flow } from "./flows";
import { initDb, getDb } from "./database/surreal";

const PORT = process.env?.PORT ?? 3008;

let contacts = {};

const main = async () => {
	const adapterProvider = createProvider(Provider, { writeMyself: 'both' });
	const adapterDB = new Database();

	initDb()

	const { httpServer, handleCtx } = await createBot({
		flow: flow,
		provider: adapterProvider,
		database: adapterDB,
	});

	try {
		adapterProvider.on("ready", () => {
			if (adapterProvider.store && adapterProvider.store.contacts) {
				contacts = adapterProvider.store.contacts;
			}
		});
	} catch (error) {
		console.error(error);
	}

	adapterProvider.on("reaction", async (ctx) => {
		console.debug(ctx)
	});

	adapterProvider.on("message", async (ctx) => {
		adapterProvider.vendor.readMessages([ctx.key]);
	});

	httpInject(adapterProvider.server);
	httpServer(+PORT);

	adapterProvider.server.post(
		"/v1/messages",
		handleCtx(async (bot, req, res) => {
			const { number, message, urlMedia } = req.body;
			await bot.sendMessage(number, message, { media: urlMedia ?? null });
			return res.end("sended");
		})
	);

	adapterProvider.server.post(
		"/v1/register",
		handleCtx(async (bot, req, res) => {
			const { number, name } = req.body;
			await bot.dispatch("REGISTER_FLOW", { from: number, name });
			return res.end("trigger");
		})
	);

	adapterProvider.server.post(
		"/v1/blacklist",
		handleCtx(async (bot, req, res) => {
			const { number, intent } = req.body;
			if (intent === "remove") bot.blacklist.remove(number);
			if (intent === "add") bot.blacklist.add(number);

			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ status: "ok", number, intent }));
		})
	);
};

main();
