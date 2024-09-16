import { addKeyword } from "@builderbot/bot";
import { getMessage, setLanguage } from '../services/translate';

export const languageFlow = addKeyword(['language', 'lenguaje'])
  .addAction(async (ctx, { provider }) => {
    const userChoice = ctx.body.toLowerCase().trim();
    console.log(`Received user choice: "${userChoice}"`);

    const number = ctx.key.remoteJid;

    let responseMessage: string;

    if (userChoice.includes('español') || userChoice.includes('es') || userChoice.includes('spanish')) {
      setLanguage('es');
      responseMessage = getMessage('languageSetConfirmation');
      console.log(`Language set to Spanish.`);
    } else if (userChoice.includes('english') || userChoice.includes('inglés') || userChoice.includes('ingles') || userChoice.includes('en')) {
      setLanguage('en');
      responseMessage = getMessage('languageSetConfirmation');
      console.log(`Language set to English.`);
    } else {
      responseMessage = getMessage('languageNotRecognized');
      console.log(`Language not recognized.`);
    }

    if (!responseMessage) {
      responseMessage = "An error occurred while processing your request.";
      console.error("Response message is undefined.");
    }

    try {
      await provider.vendor.sendMessage(number, {
        text: responseMessage,
      });
      console.log(`Sent message: "${responseMessage}"`);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  });
