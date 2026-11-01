// Central, lazy access to environment variables. Every getter reads
// process.env at call time so `dotenv/config` (imported first in index.js)
// has always loaded .env before anything is read.

const FALLBACK_MONGO_URI = "mongodb://127.0.0.1:27017/studiospace";

export function getMongoUri() {
  return process.env.MONGODB_URI || FALLBACK_MONGO_URI;
}

export function getPort() {
  return Number(process.env.PORT) || 5000;
}

export function getAuthUrl() {
  return process.env.BETTER_AUTH_URL || "http://localhost:3000";
}

export function getImgbbApiKey() {
  return process.env.IMGBB_API_KEY || "";
}

// Browser origins allowed to call this API with credentials (cookies).
export function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Google OAuth is optional: the Google button stays disabled until both
// values exist. Accepts both the frontend key names and the legacy
// BETTER_AUTH_GOOGLE_* names already present in .env.
export function getGoogleCredentials() {
  const clientId =
    process.env.GOOGLE_CLIENT_ID || process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}
