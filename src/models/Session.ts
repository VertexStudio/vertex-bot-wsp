import { getDb } from "~/database/surreal";

export class Session {
  static readonly DEFAULT_SYSTEM_MESSAGE = `You are a helpful assistant in a WhatsApp group chat. Follow these guidelines:
  
  1. Role: You are a helpful, friendly assistant named VeoVeo Bot. You do NOT impersonate or speak for any human users.
  
  2. Message Format: User messages are prefixed with '[user_name]: '. Treat these as direct input from group members.
  
  4. Response Style:
     - Be natural, helpful, and concise.
     - Engage with users individually and remember context from previous messages.
     - Do not repeat user names or prefixes in your responses.
     - Speak only in one language.
  
  5. Group Dynamics:
     - Be aware of multiple users in the conversation.
     - Don't assume information about users that hasn't been explicitly stated.
     - If a user asks about another user, only reference information that has been shared in the visible conversation.
  
  6. Limitations:
     - Do not generate or pretend to be user messages.
     - If you're unsure about something, it's okay to say so.
  
  7. Context Awareness:
     - Pay attention to the flow of conversation.
     - Query tool results when the user asks about the image.
  
  Remember, your role is to assist and interact as VeoVeo Bot.`;

  private static readonly MAX_CHAR_LIMIT = 512000;

  messages: Array<{ role: string; content: string }>;

  constructor() {
    this.messages = [
      { role: "system", content: Session.DEFAULT_SYSTEM_MESSAGE },
    ];
  }

  async addMessages(
    conversation: string,
    ...messages: { role: string; content: string }[]
  ) {
    const db = getDb();

    const createQueries = messages.map(
      (msg) =>
        `LET $message = CREATE message SET content = ${JSON.stringify(
          msg.content
        )}, created_at = time::now();
        RELATE conversation:${conversation}->conversation_messages->$message;
        RELATE $message->message_role->role:${msg.role};`
    );

    await db.query(`
      BEGIN TRANSACTION;
      ${createQueries.join("; ")};
      COMMIT TRANSACTION;
    `);

    this.messages.push(...messages);
    this.trimMessages();
  }

  private trimMessages() {
    let totalChars = this.messages.reduce(
      (sum, msg) => sum + msg.content.length,
      0
    );
    while (totalChars > Session.MAX_CHAR_LIMIT && this.messages.length > 1) {
      const removed = this.messages.splice(1, 1)[0];
      totalChars -= removed.content.length;
    }
  }
}

export const sessions = new Map<string, Session>();
