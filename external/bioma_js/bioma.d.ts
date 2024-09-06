export interface BiomaInterface {
  connect(): Promise<void>;
  createActorId(type: string, name: string): { id: string };
  createActor(actorId: { id: string }): Promise<void>;
  waitForReply(actorId: string): Promise<any>;
  sendMessage(
    actorId: { id: string },
    tx: any,
    name: string,
    msg: any
  ): Promise<void>;
}

export const BiomaInterface: new () => BiomaInterface;
