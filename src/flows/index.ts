import { createFlow } from '@builderbot/bot';
import { welcomeFlow } from "./welcomeFlow.flow";
import { mediaFlow } from "./mediaFlow";
import { voiceNoteFlow } from './voiceNote.flow';
import { groupsID } from './groupsID.flow'
import { imageFlow } from './imageFlow.flow';
import { resizeFlow } from './imageFlow.flow';
import { correctFlow } from './imageFlow.flow'
import { incorrectFlow } from './imageFlow.flow';

export const flow =  createFlow([welcomeFlow, mediaFlow, correctFlow, incorrectFlow, voiceNoteFlow, groupsID, imageFlow, resizeFlow])