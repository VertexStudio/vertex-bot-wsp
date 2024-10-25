//import { BaileysProvider } from "@builderbot/provider-baileys";
import { TelegramProvider } from '@builderbot-plugins/telegram'

export async function sendMessage(
  provider: TelegramProvider,
  remoteJid: string,
  messageText: string,
  mentions: string[] = [],
  quotedMessage?: any,
  retryCount: number = 0
) {
  try {
    await provider.vendor.telegram.sendMessage(
      remoteJid,
      { text: messageText, mentions } as any,
      quotedMessage ? { quoted: quotedMessage } as any : undefined
    );
  } catch (error) {
    if (error.message === "rate-overlimit" && retryCount < 3) {
      console.debug(
        `Rate limit exceeded. Retrying in 5 seconds... (Attempt ${
          retryCount + 1
        })`
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return sendMessage(
        provider,
        remoteJid,
        messageText,
        mentions,
        quotedMessage,
        retryCount + 1
      );
    }
    console.error("Error sending message:", error);
    throw error;
  }
}
