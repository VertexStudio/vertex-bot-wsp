import { getDb } from "~/database/surreal";
import "dotenv/config";
import { createEmbeddings } from "~/services/actors/embeddings";
import { Conversation, Message } from "./types";
import { GenerateEmbeddings } from "~/services/actors/embeddings";
import { ChatMessageRole } from "~/services/actors/chat";
import { RecordId } from "surrealdb.js";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;

export type Fact = {
  fact_value: string;
};

export class Session {
  static readonly DEFAULT_SYSTEM_MESSAGE = `You are a helpful assistant in a WhatsApp group chat of a company. Follow these guidelines:
  
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
  
  Remember, your role is to assist and interact as VeoVeo Bot and answer all queries.`;

  private static readonly MAX_CHAR_LIMIT = 512000;
  private static readonly MAX_MESSAGES = 30;
  private static readonly ID_START_NUMBER = 1;
  private static readonly MAX_QUOTES = 10;

  private messageIdCounter: number;

  messages: Message[];
  conversation: Conversation;
  participants: Array<{ id: string; name: string }>;

  quotesByUser = {};

  constructor(systemPrompt: string) {
    this.messages = [
      {
        id: new RecordId("chat_message", "system_prompt"),
        msg: systemPrompt,
        created_at: new Date().toISOString(),
        role: "system",
      },
    ];
    this.messageIdCounter = Session.ID_START_NUMBER;
    this.participants = [];
    this.conversation = null;
  }

  async addMessages(
    conversationId: string,
    ...messages: Array<{ msg: string; role: ChatMessageRole }>
  ) {
    const db = getDb();

    const createQueries = messages.map((msg, index) => {
      const query = `
        LET $chat_message = CREATE ONLY chat_message SET msg = ${JSON.stringify(
          msg.msg
        )}, created_at = time::now(), role = '${msg.role}';
        $chat_message;
        RELATE conversation:${conversationId}->conversation_chat_messages->$chat_message;
      `
        .replace(/\n/g, " ")
        .trim();
      return query;
    });

    try {
      const transactionQuery = `
        BEGIN TRANSACTION;
        ${createQueries.join(";\n")};
        COMMIT TRANSACTION;
      `;
      const result: any[] = await db.query(transactionQuery);

      const createdMessages: Message[] = [];
      for (let i = 0; i < result.length; i += 3) {
        const createdMessage: Message = result[i + 1];
        this.messages.push(createdMessage);
        createdMessages.push(createdMessage);
      }

      const embeddings_req: GenerateEmbeddings = {
        source: "vertex::VertexBotWSP",
        texts: createdMessages.map((msg) => msg.msg),
        tag: "conversation",
        metadata: createdMessages.map((msg) => ({ id: msg.id })),
      };

      const embeddingResult = await createEmbeddings(embeddings_req);

      this.trimMessages();
    } catch (error) {
      console.error("Error executing database query:", error);
      throw error;
    }
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
    // Trim by character limit
    let totalChars = this.messages.reduce(
      (sum, msg) => sum + msg.msg.length,
      0
    );
    while (totalChars > Session.MAX_CHAR_LIMIT && this.messages.length > 1) {
      const removed = this.messages.splice(1, 1)[0];
      totalChars -= removed.msg.length;
    }

    // Trim to maximum number of messages
    if (this.messages.length > Session.MAX_MESSAGES) {
      const excessMessages = this.messages.length - Session.MAX_MESSAGES;
      this.messages.splice(1, excessMessages);
    }
  }
}

export const sessions = new Map<string, Session>();
