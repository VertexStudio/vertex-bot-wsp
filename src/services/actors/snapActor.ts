import { BiomaInterface } from "external/bioma_js/bioma.js";
import { RecordId } from "surrealdb.js";
import "dotenv/config";

const BIOMA_DB_URL = `${process.env.BIOMA_DB_PROTOCOL}://${process.env.BIOMA_DB_HOST}:${process.env.BIOMA_DB_PORT}`;
const BIOMA_DB_NAMESPACE = process.env.BIOMA_DB_NAMESPACE;
const BIOMA_DB_DATABASE = process.env.BIOMA_DB_DATABASE;
const BIOMA_DB_USER = process.env.BIOMA_DB_USER;
const BIOMA_DB_PASSWORD = process.env.BIOMA_DB_PASSWORD;

const bioma = new BiomaInterface();

await bioma.connect(
  BIOMA_DB_URL || "ws://127.0.0.1:8000",
  BIOMA_DB_NAMESPACE || "dev",
  BIOMA_DB_DATABASE || "bioma",
  BIOMA_DB_USER || "root",
  BIOMA_DB_PASSWORD || "root"
);

type SnapMessage = {
  image_path: string;
  caption?: string;
};

type SnapResult = {
  err: undefined | string;
  id: RecordId;
  msg: {
    analysis: {
      id: RecordId;
      results: string;
    };
    anomaly?: {
      id: RecordId;
      status?: boolean;
      timestamp: string;
    };
  };
  name: string;
  rx: RecordId;
  tx: RecordId;
};

async function processSnap(
  image_path: string,
  caption?: string
): Promise<SnapResult> {
  try {
    const vertexBotWspId = bioma.createActorId(
      "/vertex-bot-wsp-snap",
      "vertex::VertexBotWSP"
    );
    await bioma.createActor(vertexBotWspId);

    const snapActorId = bioma.createActorId(
      "/snap_actor",
      "actors::snap_actor::SnapActor"
    );

    const snapMessage: SnapMessage = {
      image_path,
      caption,
    };

    const messageId = await bioma.sendMessage(
      vertexBotWspId,
      snapActorId,
      "actors::snap_actor::Snap",
      snapMessage
    );

    const reply = await bioma.waitForReply(messageId, 10000);

    return reply as SnapResult;
  } catch (error) {
    console.error("Error in processSnap:", error);
    throw error;
  }
}

export default processSnap;
