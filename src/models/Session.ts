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

  private static readonly MAX_TOKEN_LIMIT = 128000;

  messages: Array<{ role: string; content: string; tokens?: number }>;
  totalTokens: number;
  lastPromptEvalCount: number;

  constructor() {
    this.messages = [
      { role: "system", content: Session.DEFAULT_SYSTEM_MESSAGE },
    ];
    this.totalTokens = 0;
    this.lastPromptEvalCount = 0;
  }

  addMessage(
    message:
      | { role: string; content: string; tokens: number }
      | Array<{ role: string; content: string; tokens: number }>
  ) {
    if (Array.isArray(message)) {
      this.messages.push(...message);
      this.totalTokens += message.reduce((sum, msg) => sum + msg.tokens, 0);
    } else {
      this.messages.push(message);
      this.totalTokens += message.tokens;
    }
    this.trimMessages();
  }

  private trimMessages() {
    while (
      this.totalTokens > Session.MAX_TOKEN_LIMIT &&
      this.messages.length > 1
    ) {
      const removed = this.messages.splice(1, 1)[0];
      this.totalTokens -= removed.tokens || 0;
    }
  }

  updateLastPromptEvalCount(count: number) {
    this.lastPromptEvalCount = count;
  }
}

export const sessions = new Map<string, Session>();
