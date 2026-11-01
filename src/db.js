import { MongoClient } from "mongodb";
import { getMongoUri } from "./env.js";

// One client for the life of the process. The driver connects lazily on the
// first operation (serverSelectionTimeoutMS keeps a missing mongod from
// hanging requests — routes surface those as 503 via the error handler).
const client = new MongoClient(getMongoUri(), { serverSelectionTimeoutMS: 2000 });

// db name comes from the URI path (/studiospace) — same rule as the Next.js
// app (cat_harry_fontend/src/lib/db.js), so both apps share one database.
export function getDb() {
  return client.db();
}

export async function ping() {
  await getDb().command({ ping: 1 });
}
