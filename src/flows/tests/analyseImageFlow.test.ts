import * as messageService from "../../services/messageService";
import * as promptBuilder from "../../services/promptBuilder";
import * as translateModule from "../../services/translate";
import { getDb } from "../../database/surreal";
import { analyseImageFlow } from "../analyseImageFlow";
import { sessions } from "../../models/Session";
import { ChatMessageRole, ChatResult } from "../../services/actors/chat";
import sendChatMessage from "../../services/actors/chat";
import { ImageAnalysisType } from "../../services/promptBuilder";
import { createMockSession } from "./utils/session"

// Mock dependencies
jest.mock("../../services/actors/embeddings", () => ({
  __esModule: true,
}));
jest.mock("../../services/actors/snap", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../services/actors/chat", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../services/messageService");
jest.mock("../../services/promptBuilder", () => {
  const originalModule = jest.requireActual("../../services/promptBuilder");
  return {
    ...originalModule,
    generateImageAnalysisPrompt: jest.fn(),
  };
});
jest.mock("../../database/surreal");

describe("analyseImageFlow (handleMedia)", () => {
  const mockProvider = {
    saveFile: jest.fn().mockResolvedValue("./assets/media/test.jpg"),
  } as any;

  const mockCtx = {
    from: "123456789@g.us",
    pushName: "TestUser",
    key: {
      participant: "987654321@s.whatsapp.net",
      remoteJid: "123456789@g.us",
    },
    body: "_event_media__cb8465cb-d858-4557-9ece-e438cbcf7124",
    message: {
      imageMessage: {
        mimetype: "image/jpg",
        caption: "Analyze this image in detail",
      },
    },
  };
  let action;
  let mockGetMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    action = findActionFunction(analyseImageFlow);
    if (!action) {
      throw new Error("Could not find action function in alertsFlow");
    }

    (messageService.sendMessage as jest.Mock).mockResolvedValue(undefined);

    // Create a new mock for getMessage
    mockGetMessage = jest.fn();
    (translateModule.getMessage as jest.Mock) = mockGetMessage;
  });

  it("should send the image analysis response", async () => {
    mockGetMessage.mockReturnValue(
      "We're analyzing your image. Please wait..."
    );

    await action(mockCtx, mockProvider);

    expect(messageService.sendMessage).toHaveBeenCalled();
    const sendMessageCalls = (messageService.sendMessage as jest.Mock).mock
      .calls;
    expect(mockGetMessage).toHaveBeenCalledWith("analyzing_image");
    expect(sendMessageCalls[0]).toEqual([
      undefined,
      "123456789@g.us",
      "@987654321 We're analyzing your image. Please wait...",
      ["987654321@s.whatsapp.net"],
      mockCtx,
    ]);
  });

  it("should return a valid analysis type", async () => {
    const mockDb = {
      query: jest.fn().mockResolvedValue([{ result: "success" }]),
    };
    (getDb as jest.Mock).mockReturnValue(mockDb);
    mockGetMessage.mockReturnValue(
      "We're analyzing your image. Please wait..."
    );
    const mockSession = createMockSession();
    jest.spyOn(sessions, "get").mockReturnValue(mockSession);

    (promptBuilder.generateImageAnalysisPrompt as jest.Mock).mockReturnValue({
      system: "mocked system prompt",
      prompt: "mocked user prompt",
    });

    const mockChatResponse: ChatResult = {
      model: "llama3.1:8b",
      created_at: new Date().toISOString(),
      msg: {
        message: {
          role: "assistant" as ChatMessageRole,
          content: "more detailed caption" as ImageAnalysisType,
        },
      },
    };
    (sendChatMessage as jest.Mock).mockResolvedValue(mockChatResponse);

    await action(mockCtx, mockProvider);

    expect(promptBuilder.generateImageAnalysisPrompt).toHaveBeenCalledWith(
      "Analyze this image in detail"
    );
    expect(sendChatMessage).toHaveBeenCalled();
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "UPDATE $linkedTask SET model_task = $model_task"
      ),
      expect.objectContaining({ model_task: "more detailed caption" })
    );
  });

  it("should handle sticker error", async () => {
    mockGetMessage.mockReturnValue(
      "We're analyzing your image. Please wait..."
    );
    const mockCtxSticker = {
      from: "123456789@g.us",
      pushName: "TestUser",
      key: {
        participant: "987654321@s.whatsapp.net",
        remoteJid: "123456789@g.us",
      },
      body: "Hello, bot!",
      message: {
        stickerMessage: {
          mimetype: "image/web",
        },
      },
    };

    await action(mockCtxSticker, mockProvider);

    const sendMessageCalls = (messageService.sendMessage as jest.Mock).mock
      .calls;
    expect(sendMessageCalls[1]).toEqual([
      undefined,
      "123456789@g.us",
      "@987654321 Sorry, the sticker format is not supported for analysis",
      expect.anything(),
      mockCtxSticker,
    ]);
  });
});

function findActionFunction(obj: any): Function | null {
  if (typeof obj === "function") {
    return obj;
  }
  if (typeof obj === "object" && obj !== null) {
    for (const key in obj) {
      if (typeof obj[key] === "function") {
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
