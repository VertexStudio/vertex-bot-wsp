import { Session } from "../../../models/Session";
import { RecordId } from "surrealdb.js";
import { ChatMessageRole } from "../../../services/actors/chat";

export const createMockSession = () => {
    const mockSession = new Session(Session.DEFAULT_SYSTEM_MESSAGE);
    mockSession.conversation = {
      id: new RecordId("conversations", "conv1"),
      whatsapp_id: "123456789@g.us",
      system_prompt: "Existing prompt",
    };
    mockSession.messages = [
      {
        id: new RecordId("chat_message", "msg1"),
        msg: "Previous message",
        created_at: "2024-10-14T15:32:35.261Z",
        role: "user" as ChatMessageRole,
      },
    ];
    mockSession.addParticipant("123456789@g.us", "Test User");
    return mockSession;
  };