import { Surreal } from "surrealdb.js";

const {
    VV_DB_ENDPOINT,
    VV_DB_NAMESPACE,
    VV_DB_DATABASE,
    VV_DB_USERNAME,
    VV_DB_PASSWORD,
    CAMERA_ID,
} = process.env;

let db: Surreal | undefined;

export async function initDb(): Promise<Surreal | undefined> {
    if (db) return db;
    db = new Surreal();
    try {
        await db.connect(VV_DB_ENDPOINT, {
            namespace: VV_DB_NAMESPACE,
            database: VV_DB_DATABASE,
            auth: { username: VV_DB_USERNAME, password: VV_DB_PASSWORD },
        })
        console.debug('Connected SurrealDB')
        return db;
    } catch (err) {
        console.error("Failed to connect to SurrealDB:", err);
        throw err;
    }
}

export async function closeDb(): Promise<void> {
    if (!db) return;
    await db.close();
    db = undefined;
}

export function getDb(): Surreal | undefined {
    return db;
}