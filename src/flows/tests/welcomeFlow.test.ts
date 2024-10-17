import { welcomeFlow } from '../welcomeFlow.flow';
import { Session, sessions } from "../../models/Session";
import * as conversationService from "../../services/conversationService";
import { getRelevantMessages, getRelevantFacts, processQuotedMessage } from "../../services/messageProcessor";
import { buildPromptMessages } from "../../services/promptBuilder";
import { sendResponse } from "../../services/responseService";
import { sendMessage } from "../../services/messageService";
import { Conversation, Message } from "../../models/types";
import sendChatMessage from '../../services/actors/chat';
import { ChatMessageRole, ChatResult } from "../../services/actors/chat";
import { createMockSession } from "./utils/session"

// Mocks
jest.mock("../../services/messageService", () => ({ sendMessage: jest.fn() }));
jest.mock("../../services/actors/embeddings", () => ({
  __esModule: true,
  storeTextEmbeddings: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../services/actors/rerank", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../services/actors/chat", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../utils/fast-entires", () => ({
  createMessageQueue: jest.fn().mockImplementation(() => {
    return (message, callback) => {
      // Execute the callback after a short delay
      setTimeout(() => callback(message), 0);
    };
  }),
}));
jest.mock("../../services/messageProcessor", () => ({
  getRelevantMessages: jest.fn(),
  getRelevantFacts: jest.fn(),
  processQuotedMessage: jest.fn(),
}));
jest.mock("../../services/promptBuilder", () => ({ buildPromptMessages: jest.fn() }));
jest.mock("../../services/responseService", () => ({ sendResponse: jest.fn() }));
jest.mock("../../database/surreal", () => ({
  getDb: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue([]),
  }),
}));

describe('welcomeFlow', () => {
  const mockCtx = {
    from: '123456789@g.us',
    pushName: 'TestUser',
    key: { participant: '987654321@s.whatsapp.net', remoteJid: '123456789@g.us' },
    body: 'Hello, bot!'
  };
  const mockProvider = {};
  let action;

  beforeEach(() => {
    jest.clearAllMocks();
    action = findActionFunction(welcomeFlow);
    if (!action) {
        throw new Error('Could not find action function in alertsFlow');
    }
  });

  it('should create a new session if it does not exist', async () => {
    const mockConversation: Conversation = {
      id: {
        id: '123',
        tb: 'conversations',
        toJSON: () => '123'
      },
      whatsapp_id: '123456789@g.us',
      system_prompt: 'Test prompt'
    };

    const mockLatestMessages: Message[] = [];
    
    jest.spyOn(conversationService, 'handleConversation').mockResolvedValue({
      conversation: mockConversation,
      latestMessages: mockLatestMessages
    });

    jest.spyOn(sessions, 'get').mockReturnValue(undefined);
    const mockSet = jest.spyOn(sessions, 'set');

    const result = await action(mockCtx, { provider: mockProvider });

    expect(conversationService.handleConversation).toHaveBeenCalledWith('123456789');
    expect(mockSet).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith('123456789', expect.any(Object));
  });

  it('should use existing session if it exists', async () => {
    const mockSession = createMockSession();
    jest.spyOn(sessions, 'get').mockReturnValue(mockSession);
    const handleConversationSpy = jest.spyOn(conversationService, 'handleConversation').mockResolvedValue({
      conversation: mockSession.conversation,
      latestMessages: mockSession.messages
    });
    
    await action(mockCtx, { provider: mockProvider });
    
    expect(sessions.get).toHaveBeenCalledWith('123456789');
    expect(handleConversationSpy).not.toHaveBeenCalled();
  });

  it('should process messages and send response', async () => {
    const mockSession = createMockSession();
    jest.spyOn(sessions, 'get').mockReturnValue(mockSession);

    const mockChatResponse: ChatResult = {
      model: "llama3.1:8b",
      created_at: new Date().toISOString(),
      msg: {
        message: {
          role: 'assistant' as ChatMessageRole,
          content: 'Bot response'
        }
      }
    };
    (sendChatMessage as jest.Mock).mockResolvedValue(mockChatResponse);

    // Mock other necessary functions
    (getRelevantMessages as jest.Mock).mockResolvedValue([]);
    (getRelevantFacts as jest.Mock).mockResolvedValue('');
    (processQuotedMessage as jest.Mock).mockImplementation((ctx, session, userNumber, userName, body) => body);
    (buildPromptMessages as jest.Mock).mockReturnValue([]);

    await action(mockCtx, { provider: mockProvider });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(sendChatMessage).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(mockProvider, mockCtx, 'Bot response');
  });

  it('should handle errors and send error message', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockError = new Error('Test error');

    // Mock sessions.get to throw an error
    jest.spyOn(sessions, 'get').mockImplementation(() => {
      throw mockError;
    });

    const action = findActionFunction(welcomeFlow);
    if (!action) {
      throw new Error('Could not find action function in welcomeFlow');
    }

    await action(mockCtx, { provider: mockProvider });

    // Verify that sendMessage was called with the error message
    expect(sendMessage).toHaveBeenCalledWith(
      mockProvider,
      mockCtx.key.remoteJid,
      `errorWelcome ${mockError.message}`
    );

    // Verify that the error was logged
    expect(console.error).toHaveBeenCalledWith("Error in welcomeFlow:", mockError);
  });

  it('should handle groupId correctly when ctx.from is provided', async () => {
    jest.spyOn(sessions, 'get').mockReturnValue(new Session(Session.DEFAULT_SYSTEM_MESSAGE));
    await action(mockCtx, { provider: mockProvider });
    expect(sessions.get).toHaveBeenCalledWith('123456789');
  });

  it('should use ctx.pushName for userName and ctx.key.participant for userNumber when available', async () => {
    const mockSession = new Session(Session.DEFAULT_SYSTEM_MESSAGE);
    jest.spyOn(sessions, 'get').mockReturnValue(mockSession);
    jest.spyOn(mockSession, 'addParticipant');

    await action(mockCtx, { provider: mockProvider });
    expect(mockSession.addParticipant).toHaveBeenCalledWith('987654321@s.whatsapp.net', 'TestUser');
  });
});

function findActionFunction(obj: any): Function | null {
    if (typeof obj === 'function') {
      return obj;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        if (typeof obj[key] === 'function') {
          return obj[key];
        }
        const nestedResult = findActionFunction(obj[key]);
        if (nestedResult) {
          return nestedResult;
        }
      }
    }
    return null;
  }