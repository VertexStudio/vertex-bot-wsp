import { getDb } from "~/database/surreal";

export type Fact = {
  fact_value: string;
  embedding: {
    vector: number[];
  };
};

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
     - Only consider previously cited quotes if they are directly relevant to the user's current query. Ignore quotes that are unrelated to the current user prompt.
  
  Remember, your role is to assist and interact as VeoVeo Bot.`;

  private static readonly MAX_CHAR_LIMIT = 512000;
  private static readonly ID_START_NUMBER = 1;
  private static readonly MAX_QUOTES = 10;

  private messageIdCounter: number;

  messages: Array<{ id: number; role: string; content: string }>;

  participants: Array<{ id: string; name: string }>;

  quotesByUser = {};

  constructor() {
    this.messages = [
      {
        id: Session.ID_START_NUMBER,
        role: "system",
        content: Session.DEFAULT_SYSTEM_MESSAGE,
      },
    ];
    this.messageIdCounter = Session.ID_START_NUMBER;
    this.participants = [];
    this.messageIdCounter = Session.ID_START_NUMBER;
    this.participants = [];
  }

  async addMessages(
    conversation: string,
    ...messages: { role: string; content: string }[]
  ) {
    messages.map((msg) => {
      console.debug("Adding message:", msg);
    });
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

    messages.forEach((msg) => {
      this.messages.push({ id: ++this.messageIdCounter, ...msg });
    });
    this.trimMessages();
  }

  addParticipant(id: string, name: string) {
    if (!this.participants.find((p) => p.id === id)) {
      this.participants.push({ id, name });
    }
  }

  getParticipantName(id: string) {
    const participant = this.participants.find((p) => p.id === id);
    return participant ? participant.name : "assistant";
  }

  createQuotesByUser(userNumber: string) {
    if (!this.quotesByUser[userNumber]) {
      this.quotesByUser[userNumber] = new Set();
    }
  }

  addQuoteByUser(userNumber: string, newQuote: string) {
    if (this.quotesByUser[userNumber].size >= Session.MAX_QUOTES) {
      this.quotesByUser[userNumber].delete(
        this.quotesByUser[userNumber].values().next().value
      );
    }
    this.quotesByUser[userNumber].add(newQuote);
  }

  getQuotesByUser(userNumber: string) {
    let quotes = "";
    this.quotesByUser[userNumber].forEach((quote) => {
      quotes += `'${quote}' \n`;
    });
    return quotes;
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

export async function getFacts() {
  const db = getDb();
  const facts = await db.query<Fact[]>("SELECT * FROM fact");
  return facts;
}

export async function setupFactsLiveQuery(callback: (facts: Fact[]) => void) {
  const db = getDb();

  try {
    const liveQuery = await db.live<Fact>("fact", (data) => {
      getFacts().then(callback);
    });

    return liveQuery;
  } catch (error) {
    console.error("Error setting up live query:", error);
  }
}
