import { createFlow } from '@builderbot/bot';
import { welcomeFlow } from "./welcomeFlow.flow";
import { mediaFlow } from "./mediaFlow";
import { locationFlow } from "./location.flow";
import { voiceNoteFlow } from './voiceNote.flow';
import { msgPriv } from './msgPriv.flow';
import { groupsID } from './groupsID.flow'
import { groupFlow } from './groupFlow.flow';
import { menu } from './menu.flow';
import { statusFlow } from './status.flow';
import { fullSamplesFlow } from './sampleFlow.flow';
import { imageFlow } from './imageFlow.flow';
import { resizeFlow } from './imageFlow.flow';

export const flow =  createFlow([welcomeFlow, mediaFlow, locationFlow, voiceNoteFlow, msgPriv, groupsID, groupFlow, menu, statusFlow, fullSamplesFlow, imageFlow, resizeFlow])