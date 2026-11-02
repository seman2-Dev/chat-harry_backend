import express from "express";
import cors from "cors";
import { authHandler } from "./auth.js";
import { getAllowedOrigins } from "./env.js";
import { ping } from "./db.js";
import { studiosRouter } from "./routes/studios.js";
import { bookingsRouter } from "./routes/bookings.js";
import { uploadsRouter } from "./routes/uploads.js";
import { wishlistRouter } from "./routes/wishlist.js";
import { reviewsRouter } from "./routes/reviews.js";
import { errorHandler } from "./errors.js";

export function createApp() {
  const app = express();

  // Behind Vercel/Render proxies the real client IP/proto come from X-Forwarded-*.
  app.set("trust proxy", 1);

  // Cookies are HttpOnly session tokens → cross-origin callers need
  // credentials, which only works with an explicit allowed origin.
  app.use(cors({ origin: getAllowedOrigins(), credentials: true }));

  // BetterAuth must see the raw body (sign-in/sign-up/oauth callbacks), so its
  // handler is mounted BEFORE express.json() and only claims /api/auth/*.
  app.all("/api/auth/*splat", authHandler);

  app.use(express.json({ limit: "7mb" }));

  app.get("/", (req, res) => {
    res.json({ name: "StudioSpace API", ok: true, health: "/api/health" });
  });

  app.get("/api/health", async (req, res) => {
    try {
      await ping();
      res.json({ ok: true, db: "up" });
    } catch {
      res.status(503).json({ ok: false, db: "down" });
    }
  });

  app.use("/api/studios", studiosRouter);
  app.use("/api/bookings", bookingsRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/wishlist", wishlistRouter);
  app.use("/api/studios/:id/reviews", reviewsRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found." });
  });

  app.use(errorHandler);

  return app;
}
