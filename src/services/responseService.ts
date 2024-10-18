import { sendMessage } from "../services/messageService";

export async function sendResponse(provider: any, ctx: any, content: string) {
  let messageText = content;
  let mentions: string[] = [];

  if (ctx.messageCtx.update.message.from.username) {
    messageText = `@${ctx.messageCtx.update.message.from.username} ${messageText}`;
    mentions = [ctx.messageCtx.update.message.from.username];
  }

  await sendMessage(provider, ctx.from, messageText, mentions, ctx);
}
