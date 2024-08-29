import messages from '../utils/messages.json';

let currentLanguage = 'en';

export function setLanguage(lang: string) {
  console.log(`Setting language to: ${lang}`);
  currentLanguage = lang;
}

export function getLanguage() {
  return currentLanguage;
}

export function getMessage(key: string) {
  const lang = getLanguage();
  console.log(`Getting message for key: ${key}, in language: ${lang}`);
  return messages[lang][key] || messages['en'][key];
}
