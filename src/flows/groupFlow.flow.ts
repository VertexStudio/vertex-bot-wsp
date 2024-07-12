import { addKeyword, EVENTS } from '@builderbot/bot'
import { menu } from './menu.flow'
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";

export const groupFlow = addKeyword<Provider, Database>(["menu"])
    .addAnswer(['Select an option:\n\n', '1 Menu', '2 End'])
    .addAction(
        { capture: true },
        async (ctx, { gotoFlow, endFlow, fallBack }) => {
            const resp = ctx.body
            if (resp === "1") {
                return gotoFlow(menu)
            } else if (resp === "2") {
                return endFlow('End')
            } else {
                return fallBack(`Option ${resp} is not valid, try it again.`)
            }
        }
    )