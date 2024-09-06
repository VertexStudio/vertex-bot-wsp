import { Surreal, RecordId } from "surrealdb";

export class BiomaInterface {
  db: Surreal;

  constructor();

  connect(
    url?: string,
    namespace?: string,
    database?: string,
    user?: string,
    password?: string
  ): Promise<void>;

  close(): Promise<void>;

  createActorId(id: string, kind: string): { id: RecordId; kind: string };

  createActor(id: { id: RecordId; kind: string }): Promise<any>;

  sendMessage(
    tx: { id: RecordId },
    rx: RecordId,
    name: string,
    message: any
  ): Promise<string>;

  waitForReply(actorId: RecordId): Promise<any>;
}
