import { addKeyword, EVENTS } from '@builderbot/bot'
import { groupFlow } from './groupFlow.flow'

export const menu = addKeyword(EVENTS.ACTION)
    .addAnswer(['Select an option:\n\n*SubMenu 2*\n', '1 Go back', '2 End'])
    .addAction(
        { capture: true },
        async (ctx, { gotoFlow, endFlow, fallBack }) => {
            const resp = ctx.body
            if (resp === "1") {
                return gotoFlow(groupFlow)
            } else if (resp === "2") {
                return endFlow('End')
            } else {
                return fallBack(`Option ${resp} is not valid, try it again.`)
            }
        }
    )