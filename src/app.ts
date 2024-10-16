import "dotenv/config";
import { createBot, createProvider } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
//import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { flow } from "./flows";
import { initDb } from "./database/surreal";
import { TelegramProvider } from '@builderbot-plugins/telegram'

const VERTEX_BOT_PORT = process.env?.VERTEX_BOT_PORT ?? 3008;

//let contacts = {};

const main = async () => {
  //const adapterProvider = createProvider(Provider, { writeMyself: "both" });
  const adapterProvider = createProvider(TelegramProvider, {
    token: '7837560014:AAEL67IQhxo6ppHmLtkhb39dhoygacNN8wE'
  })

  const adapterDB = new Database();

  await initDb();

  const { httpServer, handleCtx } = await createBot({
    flow: flow,
    provider: adapterProvider,
    database: adapterDB,
  });

  /*try {
    adapterProvider.on("ready", () => {
      if (adapterProvider.store && adapterProvider.store.contacts) {
        contacts = adapterProvider.store.contacts;
      }
    });
  } catch (error) {
    console.error(error);
  }

  adapterProvider.on("reaction", async (ctx) => {
    console.debug(ctx);
  });

  adapterProvider.on("message", async (ctx) => {
    adapterProvider.vendor.readMessages([ctx.key]);
  });*/

  adapterProvider.on("callback_query", async (action) => {
    console.log("Action on app.ts:", action);

    const callbackData = action.update.callback_query?.data;
    const chatId = action.update.callback_query.message.chat.id;

    try {
      if (callbackData === '👍') {
        await adapterProvider.vendor.telegram.sendMessage(chatId, '👍 Received!');
      } else if (callbackData === '👎') {
        await adapterProvider.vendor.telegram.sendMessage(chatId, '👎 Received!');
      } else {
        await adapterProvider.vendor.telegram.sendMessage(chatId, `Received: ${callbackData}`);
      }

      await adapterProvider.vendor.telegram.answerCbQuery(action.update.callback_query.id);
    } catch (error) {
      console.error(`[ERROR]: Error handling callback_query: ${error.message}`);
    }
  });

  adapterProvider.on("message", async (ctx) => {
    console.log("Message:", ctx);
  });

  httpServer(+VERTEX_BOT_PORT);

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

main().catch(console.error);
