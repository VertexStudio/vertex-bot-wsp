import { EVENTS, addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";

export const msgPriv = addKeyword<Provider, Database>(["privado"])
	.addAnswer(`🙌 Example message to person`)
	.addAction(async (_, { provider }) => {
		try {
			await provider.sendText("59895278948@c.us", "Test message to person");
		} catch (error) {
			console.log(error);
		}
	});
