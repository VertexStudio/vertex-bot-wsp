import { createFlow } from "@builderbot/bot";
import { welcomeFlow } from "./welcomeFlow.flow";
import { mediaFlow } from "./mediaFlow";
import { voiceNoteFlow } from "./voiceNote.flow";
import { groupsID } from "./groupsID.flow";
import { alertsFlow } from "./alertsFlow.flow";
import { resizeFlow } from "./alertsFlow.flow";
import { analyseImageFlow } from "./analyseImageFlow";

export const flow = createFlow([
  welcomeFlow,
  //   mediaFlow,
  voiceNoteFlow,
  groupsID,
  alertsFlow,
  resizeFlow,
  analyseImageFlow,
]);
