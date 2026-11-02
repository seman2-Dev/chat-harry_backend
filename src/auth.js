import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { jwt } from "better-auth/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";
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
  // Issue short-lived, asymmetric JWTs for API mutations. Browser login still
  // uses the existing HttpOnly Better Auth session cookie.
  plugins: [
    jwt({
      jwt: {
        issuer: getAuthUrl(),
        audience: getAuthUrl(),
        expirationTime: "15m",
        definePayload: ({ user }) => ({
          sub: user.id,
          email: user.email,
          name: user.name,
        }),
      },
    }),
  ],
});

// BetterAuth's Node adapter: handles /api/auth/* (sign-up, sign-in, sign-out,
// get-session, Google callback, ...). Mounted before express.json() in app.js.
export const authHandler = toNodeHandler(auth);

const issuer = getAuthUrl();
const jwks = createRemoteJWKSet(new URL("/api/auth/jwks", issuer));

function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized" });
}

// Challenge 1: every mutating route sits behind this. The session token lives
// in an HttpOnly cookie, so only the server can present it to BetterAuth.
export async function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization;
    if (authorization !== undefined) {
      const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
      if (!match) return unauthorized(res);

      const { payload } = await jwtVerify(match[1], jwks, {
        issuer,
        audience: issuer,
        algorithms: ["EdDSA"],
      });
      if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
        return unauthorized(res);
      }
      req.session = {
        user: {
          id: payload.sub,
          email: payload.email,
          name: typeof payload.name === "string" ? payload.name : "",
        },
      };
      return next();
    }

    // Keep existing browser sessions and sign-in flow working. If a caller
    // supplies a Bearer token, it must validate; an invalid token never falls
    // back to a cookie.
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return unauthorized(res);
    }
    req.session = session;
    next();
  } catch (error) {
    if (
      error?.code?.startsWith("ERR_JWT") ||
      error?.code?.startsWith("ERR_JWS") ||
      error?.code?.startsWith("ERR_JWKS")
    ) {
      return unauthorized(res);
    }
    next(error);
  }
}
