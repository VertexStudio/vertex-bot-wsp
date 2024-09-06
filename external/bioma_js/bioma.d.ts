import { Surreal, RecordId } from "surrealdb";
import { ulid } from "ulid";

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
    tx: { id: RecordId; kind: string },
    rx: { id: RecordId; kind: string },
    name: string,
    message: any
  ): Promise<ulid>;

  waitForReply(actorId: ulid): Promise<any>;
}
