'use strict';

var bodyParser = require('body-parser');
var polka = require('polka');
var bot = require('@builderbot/bot');
require('dotenv/config');
var telegraf = require('telegraf');

const idCtxBot = 'ctx-bot';

class TelegramHttpServer extends bot.EventEmitterClass {
    constructor(port) {
        super();
        this.port = port;
        this.server = this.buildHTTPServer();
    }

    /**
     * Construir HTTP Server
     */
    buildHTTPServer() {
        return polka()
            .use(bodyParser.urlencoded({ extended: true }))
            .use(bodyParser.json())
            .get('/', (_, res) => {
                res.statusCode = 200;
                res.end('Hello world!');
            })
            .post('/webhook', async (req, res) => {
                try {
                    const bot = req[idCtxBot];
                    await bot.handleUpdate(req.body);
                    res.statusCode = 200;
                    res.end();
                } catch (error) {
                    console.error('[ERROR]:', error);
                    res.statusCode = 500;
                    res.end();
                }
            });
    }

    /**
     * Iniciar el servidor HTTP
     */
    start(vendor, port) {
        this.port = port || this.port;
        this.server.use(async (req, _, next) => {
            req[idCtxBot] = vendor;
            if (req[idCtxBot]) return next();
            return next();
        });
        this.server.listen(this.port, () => {
            console.log(`[telegram]: GET http://localhost:${this.port}/`);
            console.log(`[telegram]: POST http://localhost:${this.port}/webhook`);
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            this.server.server.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

/**
 *
 * @param ctxPolka
 * @returns
 */
const handleCtx = (ctxPolka) => (req, res) => {
    const bot = req[idCtxBot] ?? undefined;
    ctxPolka(bot, req, res);
};

class TelegramProvider extends bot.ProviderClass {
    constructor(globalVendorArgs) {
        super();

        /**
         * @alpha
         * @param {string} chatId
         * @param {string} message
         * @example await sendMessage('+XXXXXXXXXXX', 'https://dominio.com/imagen.jpg' | 'img/imagen.jpg')
         */
        this.sendMedia = async (chatId, media, caption) => {
            if (media.match(/(image|\.(jpg|jpeg|png))/gim))
                return this.sendImage(chatId, media, caption);
            if (media.match(/\.(docx?|pdf|txt|rtf)/gim))
                return this.sendFile(chatId, media, caption);
            if (media.match(/\.(mp3|wav|ogg)$/gim))
                return this.sendAudio(chatId, media, caption);
            if (media.match(/video|(\.(mp4))/gim))
                return this.sendVideo(chatId, media, caption);
            this.sendMessage(chatId, caption);
        };

        this.sendMessage = async (chatId, text, extra) => {
            console.info('[INFO]: Sending message to', chatId);
            const options = extra?.options || {};
            if (options?.buttons?.length)
                return this.sendButtons(chatId, text, options.buttons);
            if (options?.media)
                return this.sendMedia(chatId, options.media, text);
            return this.telegram.sendMessage(chatId, text);
        };

        this.saveFile = async (ctx, opts) => {
            const { path, fileType } = opts;
            ctx = ctx?.messageCtx;
            let file_id;

            const message = ctx.update?.message;
            try {
                switch (fileType) {
                    case "photo":
                        file_id = message.photo.at(-1).file_id;
                        break;
                    case "voice":
                        file_id = message.voice.at(-1).file_id;
                        break;
                    case "document":
                        file_id = message.document.at(-1).file_id;
                        break;
                    default:
                        file_id = message.photo.at(-1).file_id;
                        break;
                }
            } catch (error) {
                throw new Error(`[ERROR]: ${error?.message}`);
            }

            const { href: url } = await this.telegram.getFileLink(file_id);
            return url;
        };

        this.globalVendorArgs = { ...this.globalVendorArgs, ...globalVendorArgs };
    }

    initProvider() {
        this.handleError();
        console.info('[INFO]: Provider loaded');

        this.vendor.launch();
    }

    handleError() {
        this.vendor.catch((error) => {
            console.error(`[ERROR]: ${error?.message}`);
        });
    }

    beforeHttpServerInit() {
        // Implementa la lógica necesaria
    }

    afterHttpServerInit() {
        // Implementa la lógica necesaria
    }

    async initVendor() {
        this.vendor = new telegraf.Telegraf(this.globalVendorArgs?.token || process.env.TELEGRAM_TOKEN);
        this.initProvider();
        this.server = new TelegramHttpServer(this.globalVendorArgs?.port || 9000).server;
        this.telegram = this.vendor.telegram;

        return this.vendor;
    }

    busEvents() {
        return [
            {
                event: 'message',
                func: (messageCtx) => {
                    const payload = {
                        messageCtx: {
                            ...messageCtx,
                        },
                        from: messageCtx?.chat?.id,
                    };
                    console.log(payload);
                    console.log(messageCtx?.chat?.id);

                    if (messageCtx.message) {
                        payload.body = messageCtx.update?.message?.text;
                    }

                    if (messageCtx?.message.voice) {
                        payload.body = bot.utils.generateRefProvider('_event_voice_note_');
                    }

                    if (['photo', 'video'].some((prop) => prop in Object(messageCtx?.update?.message))) {
                        payload.body = bot.utils.generateRefProvider('_event_media_');
                    }

                    if (messageCtx?.update?.message?.location) {
                        payload.body = bot.utils.generateRefProvider('_event_location_');
                    }

                    if (messageCtx?.update?.message?.document) {
                        payload.body = bot.utils.generateRefProvider('_event_document_');
                    }

                    this.emit('message', payload);
                },
            },
            {
                event: 'callback_query',
                func: (action) => {
                    this.emit('callback_query', action);
                }, 
            }
        ];
    }

    sendImage(chatId, media, caption) {
        if (typeof media === 'string' && !media.match(/^(http|https)/)) {
            media = {
                source: media,
            };
        }
        this.telegram.sendPhoto(chatId, media, { caption });
    }

    sendFile(chatId, media, caption) {
        if (typeof media === 'string' && !media.match(/^(http|https)/)) {
            media = {
                source: media,
            };
        }
        this.telegram.sendDocument(chatId, media, { caption });
    }

    sendButtons(chatId, text, buttons) {
        this.telegram.sendMessage(chatId, text, {
            reply_markup: {
                inline_keyboard: [
                    buttons.map((btn) => ({
                        text: btn.body,
                        callback_data: btn.body,
                    })),
                ],
            },
        });
    }

    sendVideo(chatId, media, caption) {
        if (typeof media === 'string' && !media.match(/^(http|https)/)) {
            media = {
                source: media,
            };
        }
        this.telegram.sendVideo(chatId, media, { caption });
    }

    sendAudio(chatId, media, caption) {
        if (typeof media === 'string' && !media.match(/^(http|https)/)) {
            media = {
                source: media,
            };
        }
        this.telegram.sendAudio(chatId, media, { caption });
    }
}

exports.TelegramProvider = TelegramProvider;
exports.handleCtx = handleCtx;
