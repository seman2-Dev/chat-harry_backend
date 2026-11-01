import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { getDb } from "./db.js";
import { getAllowedOrigins, getAuthUrl, getGoogleCredentials } from "./env.js";

// Mirrors cat_harry_fontend/src/lib/auth.js (minus the nextCookies plugin,
// which only exists for Next.js server actions). Both apps must share the
// same BETTER_AUTH_SECRET and MongoDB database, otherwise a session cookie
// issued by one app will not validate on the other.
const google = getGoogleCredentials();

export const auth = betterAuth({
  baseURL: getAuthUrl(),
  trustedOrigins: getAllowedOrigins(),
  database: mongodbAdapter(getDb()),
  emailAndPassword: {
    enabled: true,
    // Assignment requires passwords of at least 6 characters (default is 8).
    minPasswordLength: 6,
    // Registering must land on the Login page, so no session on sign-up.
    autoSignIn: false,
  },
  socialProviders: google ? { google } : undefined,
});

// BetterAuth's Node adapter: handles /api/auth/* (sign-up, sign-in, sign-out,
// get-session, Google callback, ...). Mounted before express.json() in app.js.
export const authHandler = toNodeHandler(auth);

// Challenge 1: every mutating route sits behind this. The session token lives
// in an HttpOnly cookie, so only the server can present it to BetterAuth.
export async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}
