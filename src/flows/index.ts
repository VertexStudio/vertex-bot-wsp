import { createFlow } from "@builderbot/bot";
import { welcomeFlow } from "./welcomeFlow.flow";
import { alertsFlow } from "./alertsFlow.flow";
import { analyseImageFlow } from "./analyseImageFlow";
import { languageFlow } from './languageFlow'

export const flow = createFlow([
  welcomeFlow,
  alertsFlow,
  languageFlow,
  analyseImageFlow,
]);
