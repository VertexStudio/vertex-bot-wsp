import "dotenv/config";
import { addKeyword, EVENTS } from "@builderbot/bot";
import { typing } from "../utils/presence";
import { createMessageQueue, QueueConfig } from "../utils/fast-entires";
import { callOllamaAPIChat } from "../services/ollamaService";
import { Session, sessions } from "../models/Session";
import { sendMessage } from "../services/messageService";
import { setupLogger } from '../utils/logger';

const queueConfig: QueueConfig = { gapSeconds: 3000 };
const enqueueMessage = createMessageQueue(queueConfig);

setupLogger();

export const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { provider }) => {
    //console.log('welcomeFlow ctx: ', JSON.stringify(ctx, null, 2));
    try {
      await typing(ctx, provider);
      enqueueMessage(ctx.body, async (body) => {
        console.debug("Processed messages:", body);
        const userId = ctx.key.remoteJid;
        const userName = ctx.pushName || "User";
        const userNumber = ctx.key.participant || ctx.key.remoteJid; //if ctx comes from a group, uses key.participant, otherwise uses key.remoteJid
        
        if (!sessions.has(userId)) {
          sessions.set(userId, new Session());
        }

        const session = sessions.get(userId)!;
        
        session.addParticipant(userNumber, userName);

        if (ctx.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
          
          //console.log('Quoted message: ', JSON.stringify(ctx.message.extendedTextMessage.contextInfo.quotedMessage, null, 2));
          const quotedMessage = ctx.message.extendedTextMessage.contextInfo.quotedMessage.extendedTextMessage?.text
            || ctx.message.extendedTextMessage.contextInfo.quotedMessage.conversation;

          if (quotedMessage) {
            // Get the participant number of the quoted message
            const quotedParticipantNumber = ctx.message.extendedTextMessage.contextInfo.participant
              || ctx.message.extendedTextMessage.contextInfo.mentionedJid[0];

            // Get the participant name of the quoted message
            const quotedParticipantName = session.getParticipantName(quotedParticipantNumber);

            // Create set for user if it doesn't exist
            if(!session.quotesByUser[userNumber]) {
              session.createQuotesByUser(userNumber);
            }
            
            // Add the quote to the user's set
            session.addQuoteByUser(userNumber, `${quotedParticipantName}: ${quotedMessage}`);

            // Get all quotes for the user
            const quotes = session.getQuotesByUser(userNumber);

            //console.log('Quotes: ', quotes);
            body = `quotes: ${quotes} User ${userName} prompt: ${ctx.body}`;
            //console.log('Body: ', body);
          }
        }

        const response = await callOllamaAPIChat(session, body, {
          temperature: 0.3,
          top_k: 20,
          top_p: 0.45,
          num_ctx: 30720,
        });

        session.addMessages(
          { role: "user", content: `${userName} ${body}` },
          response
        );

        console.log("Session messages: ", session.messages);
        console.log("Session participants: ", session.participants);

        let messageText = response.content;
        let mentions: string[] = [];

        if (ctx.key.participant) {
          messageText = `@${ctx.key.participant.split("@")[0]} ${messageText}`;
          mentions = [ctx.key.participant];
        }

        await sendMessage(
          provider,
          ctx.key.remoteJid,
          messageText,
          mentions,
          ctx
        );
      });
    } catch (error) {
      console.error("Error in welcomeFlow:", error);
      await sendMessage(
        provider,
        ctx.key.remoteJid,
        `Error in welcomeFlow: ${error.message}`,
        [],
        ctx
      );
    }
  }
);
