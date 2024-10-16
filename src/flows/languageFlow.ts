import { addKeyword } from "@builderbot/bot";
import { getMessage, setLanguage } from '../services/translate';

const SUPPORTED_LANGUAGES = {
  es: ['español', 'es', 'spanish'],
  en: ['english', 'inglés', 'ingles', 'en'],
};

export const languageFlow = addKeyword(['language', 'lenguaje'])
  .addAction(async (ctx, { provider }) => {
    const userChoice = ctx.body.toLowerCase().trim();
    console.log(`Received user choice: "${userChoice}"`);

    const number = ctx.from;

    let languageCode: string | undefined = undefined;

    for (const [lang, keywords] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (keywords.some(keyword => userChoice.includes(keyword))) {
        languageCode = lang; 
        break;
      }
    }

    let responseMessage: string;

    if (languageCode) {
      setLanguage(languageCode);
      responseMessage = getMessage('languageSetConfirmation');
      console.log(`Language set to ${languageCode === 'es' ? 'Spanish' : 'English'}.`);
    } else {
      responseMessage = getMessage('languageNotRecognized') + ' ' + getMessage('availableLanguages');
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
