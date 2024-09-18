import { createFlow } from "@builderbot/bot";
import { welcomeFlow } from "./welcomeFlow.flow";
import { groupsID } from "./groupsID.flow";
import { alertsFlow } from "./alertsFlow.flow";
import { analyseImageFlow } from "./analyseImageFlow";
import { languageFlow } from './languageFlow'

export const flow = createFlow([
  //welcomeFlow,
  groupsID,
  //alertsFlow,
  languageFlow,
  //analyseImageFlow,
]);
