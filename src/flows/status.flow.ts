import { addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";

const PHONE_NUMBER = "59898262396"

export const statusFlow = addKeyword<Provider, Database>(["status"])
    .addAnswer(`💡 Example *Whatsapp Status*`)
    .addAction(
        async (_, { provider, flowDynamic }) => {
            const statusInfo = await provider.vendor.fetchStatus(PHONE_NUMBER + '@s.whatsapp.net')
            console.log(statusInfo)
            await flowDynamic(`*Status Info for ${PHONE_NUMBER}*:\n\nStatus: *${statusInfo.status}*\nSet At: ${statusInfo.setAt}`)
            await flowDynamic(`Enter phone number to check status:`)
        }
    )
    .addAction(
        { capture: true },
        async (ctx, { provider, flowDynamic }) => {
            const statusR = await provider.vendor.fetchStatus(ctx.body + '@s.whatsapp.net')
            await flowDynamic(`*Status for:* ${ctx.body}\n\nStatus: *${statusR.status}*\nSet At: ${statusR.setAt}`)
        }
    )