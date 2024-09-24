import { getDb } from "~/database/surreal";
import Surreal from "surrealdb.js";
import { Conversation, Message } from "../models/types";
import { Session } from "~/models/Session";

export async function handleConversation(groupId: string): Promise<{
  latestMessages: Message[];
  conversation: Conversation;
}> {
  const db = getDb();

  const conversation = await getOrCreateConversation(db, groupId);

  const latestMessages = await getConversationMessages(db, groupId);

  return { latestMessages, conversation };
}

async function getOrCreateConversation(
  db: Surreal,
  groupId: string
): Promise<Conversation> {
  const [result] = await db.query<Conversation[]>(`
    SELECT * FROM conversation WHERE whatsapp_id = '${groupId}'
  `);
  let conversation: Conversation | null =
    Array.isArray(result) && result.length > 0 ? result[0] : null;

  if (!conversation) {
    const [createResult] = await db.query<Conversation[]>(
      `
      CREATE conversation SET 
        id = crypto::sha256("whatsapp//${groupId}"),
        whatsapp_id = '${groupId}',
        system_prompt = $system_prompt
    `,
      {
        system_prompt: Session.DEFAULT_SYSTEM_MESSAGE,
      }
    );
    conversation = createResult[0];
  }

  return conversation;
}

async function getConversationMessages(
  db: Surreal,
  groupId: string
): Promise<Message[]> {
  const [result] = await db.query<Message[]>(`
    SELECT 
        *
    FROM (
        SELECT ->conversation_chat_messages->chat_message AS chat_message 
        FROM conversation 
        WHERE whatsapp_id = '${groupId}'
    )[0].chat_message 
    ORDER BY created_at DESC
    LIMIT 30;
  `);
  return Array.isArray(result) ? result : [];
}
