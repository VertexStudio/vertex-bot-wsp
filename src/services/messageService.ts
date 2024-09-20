import { BaileysProvider } from "@builderbot/provider-baileys";

export async function sendMessage(
  provider: BaileysProvider,
  remoteJid: string,
  messageText: string,
  mentions: string[] = [],
  quotedMessage?: any,
  retryCount: number = 0
) {
  try {
    console.debug("Quoted message", quotedMessage);
    await provider.vendor.sendMessage(
      remoteJid,
      { text: messageText, mentions },
      quotedMessage ? { quoted: quotedMessage } : undefined
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
