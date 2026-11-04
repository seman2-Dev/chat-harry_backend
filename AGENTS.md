# StudioSpace API — backend instructions

Express 5 (ESM) single-file app: all auth mounting, JWT verification, studios/bookings/reviews/wishlist/uploads routes, and the error handler live inline in `index.js`. `export default app` is for Vercel (`listen()` is skipped when `VERCEL=1`). This folder is its own git repo root (remote `chat-harry_backend`).

Git HEAD still contains the old modular layout (`src/*`, `scripts/smoke.sh`, `backend.md`, `.env.example`); those files are deleted-but-uncommitted in the worktree — check `git status` before trusting them.

## Commands

```bash
npm run dev     # node --watch index.js; PORT from .env (5000)
npm run check   # node --check index.js — add every new source file to this script in package.json
npm start
```

No `smoke` script exists in the worktree (`npm run smoke` → "Missing script"). The old suite at HEAD (`scripts/smoke.sh`) needs mongod + the server up plus `curl`, `jq`, `mongosh` if restored.

## Env (`.env`, never commit or print)

- Required: `MONGODB_URI`, `PORT`, `BETTER_AUTH_URL`, `CLIENT_ORIGINS`, `BETTER_AUTH_SECRET`. Optional: `IMGBB_API_KEY` (uploads), Google creds (`GOOGLE_CLIENT_*` or legacy `BETTER_AUTH_GOOGLE_*`).
- `MONGODB_URI` path names the database (`client.db()` with no arg) — it must match the frontend's and end in `/studiospace`. The current `.env` URI has an empty path, so the driver silently uses `test`.
- `BETTER_AUTH_URL` and `CLIENT_ORIGINS` must be the browser-facing frontend origin (local: `http://localhost:3000`); `BETTER_AUTH_SECRET` must equal the frontend's or its session cookie is rejected here.
- Startup is strict: missing `CLIENT_ORIGINS`/`MONGODB_URI` throws before listening.

## Routing gotchas (Express 5)

- Wildcards are named splats: `app.all("/api/auth/*splat", …)` — a bare `*` is invalid in path-to-regexp v8.
- Mount order matters: `/api/auth/*` before `express.json()` (Better Auth parses its own body); `/api/studios/featured` before `/api/studios/:id`.
- `express.json({ limit: "7mb" })` — uploads arrive as base64 data URLs in JSON; lowering the limit breaks them.
- `verifyToken`: bearer JWT verified against `/api/auth/jwks` (EdDSA, issuer/audience = `BETTER_AUTH_URL`), else Better Auth session cookie, else 401.
- Booking overlap check treats `Pending` and `Confirmed` as blocking; host transitions follow Pending → Confirmed → Completed / Cancelled rules (409 on illegal jumps).
- Rejected async handlers forward to the error middleware (no try/catch needed); bad JSON → 400 via `err.status`, everything else → 500.

## Git

Stage explicit paths only — never `git add -A` / `git add .`. Never commit `.env` (already gitignored).
