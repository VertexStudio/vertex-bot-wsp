import { RecordId } from "surrealdb.js";

export type Conversation = {
  id: RecordId;
  whatsapp_id: string;
  system_prompt: string;
};

export type Message = {
  msg: string;
  created_at: string;
  id: RecordId;
  role: RecordId;
};
