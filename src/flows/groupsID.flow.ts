import { addKeyword } from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";

const contacts = {};

export const groupsID = addKeyword<Provider, Database>(["idGroups"])
.addAnswer(`🙌 Example Groups from BOT`)
.addAction(async (_, { flowDynamic }) => {
    const groupsBot = Object.entries(contacts)
        .filter(([id, _]) => id.includes("@g"))
        .map(([id, data]) => ({ id, name: data }));
    const messages: string[] = [];
    for (const grupo of groupsBot) {
        const message = `${grupo.name ? "*Object:*" : ""} ${
            JSON.stringify(grupo?.name, null, 5) || ""
        }\n*groupId:* ${grupo.id}`;
        messages.push(message);
    }
    const concatenatedMessages = messages.join("\n\n");
    await flowDynamic(concatenatedMessages);
});