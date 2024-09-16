import { createFlow } from "@builderbot/bot";
import { welcomeFlow } from "./welcomeFlow.flow";
import { mediaFlow } from "./mediaFlow";
import { voiceNoteFlow } from "./voiceNote.flow";
import { groupsID } from "./groupsID.flow";
import { alertsFlow } from "./alertsFlow.flow";
import { analyseImageFlow } from "./analyseImageFlow";
import { languageFlow } from './languageFlow'

export const flow = createFlow([
  welcomeFlow,
  //   mediaFlow,
  voiceNoteFlow,
  groupsID,
  alertsFlow,
  languageFlow,
  analyseImageFlow,
]);
