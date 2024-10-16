import { sendMessage } from "../services/messageService";

export async function sendResponse(provider: any, ctx: any, content: string) {
  let messageText = content;
  let mentions: string[] = [];

  if (ctx.key.participant) {
    messageText = `@${ctx.key.participant.split("@")[0]} ${messageText}`;
    mentions = [ctx.key.participant];
  }

  await sendMessage(provider, ctx.from, messageText, mentions, ctx);
}
