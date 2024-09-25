import { RecordId } from "surrealdb.js";

export type Conversation = {
  id: RecordId;
  whatsapp_id: string;
  system_prompt: string;
};

export type Message = {
  id: RecordId;
  msg: string;
  created_at: string;
  role: "user" | "assistant" | "system" | "tool";
};

export interface ImageMessage {
  imagePath: string;
  timestamp: number;
  id?: string;
}

export interface Snap {
  image_path: string;
  id: Record<string, string>;
  queued_timestamp: Date;
}

export interface AnalysisAnomalies {
  out: RecordId;
  in: RecordId;
  status: boolean;
}

export interface Anomaly {
  id: RecordId;
  timestamp: Date;
}

export interface AlertControl {
  alertAnomaly: Record<string, string>;
  feedback: boolean[];
  waiting: boolean;
}
