# Backend — StudioSpace API (Express + MongoDB)

`cat_harry_backend` is the server half of assignment 8: Express 5 (ESM) + the `mongodb`
driver + BetterAuth (Node adapter). Its response contract mirrors the Next.js route
handlers the client already calls (`{ studio }`, `{ studios }`, `{ error, fields }`, same
status codes), so moving the client onto it is configuration, not a rewrite.

**Current state:** the frontend proxies its `/api/*` auth, studio, booking, upload, and
wishlist requests to this Express service. Studio detail pages continue to read MongoDB
directly on the server. Both apps use the same database and BetterAuth secret. Nothing is
deployed yet.

---

## Files

| Path | Role |
| --- | --- |
| `index.js` | Entry: `import "dotenv/config"` → `createApp()` → `listen(PORT)` |
| `src/app.js` | Express app: CORS, BetterAuth mount, JSON body, routes, 404, error handler |
| `src/auth.js` | `betterAuth()` instance (same config as the Next app), `authHandler`, `requireAuth` middleware |
| `src/db.js` | One lazy `MongoClient` (2 s server-selection timeout); `getDb()`, `ping()` |
| `src/env.js` | Lazy `process.env` getters (URI, port, CORS origins, Google creds) |
| `src/errors.js` | `ApiError` + error handler (Mongo errors → 503, bad JSON → 400) |
| `src/validate.js` | Studio/booking validation with the exact messages the forms render |
| `src/routes/studios.js` | Studios CRUD + `/featured` + list filters |
| `src/routes/bookings.js` | Bookings list/create/cancel + overlap check |
| `src/routes/uploads.js` | Authenticated image upload proxy to imgbb |
| `src/routes/wishlist.js` | User-scoped saved studios |
| `src/routes/reviews.js` | Reviews restricted to users with completed bookings |
| `scripts/smoke.sh` | 45-assertion end-to-end suite (`npm run smoke`) |
| `.env.example` | Every env key, documented |

---

## API surface

All responses are JSON. Validation failures are `{ "error": "...", "fields": { ... } }`.

| Method | Route | Auth | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | – | `{ ok, db }` | 503 if mongod down |
| GET | `/api/studios` | – | `{ studios }` | 503 |
| GET | `/api/studios/featured` | – | `{ studios }` (max 6) | 503 |
| GET | `/api/studios/:id` | – | `{ studio }` | 400 invalid id, 404 |
| POST | `/api/studios` | session | 201 `{ studio }` | 400, 401 |
| PUT | `/api/studios/:id` | owner | `{ studio }` | 400, 401, 403, 404 |
| DELETE | `/api/studios/:id` | owner | `{ ok: true }` | 401, 403, 404 |
| GET | `/api/bookings` | session | `{ bookings }` (own only) | 401 |
| POST | `/api/bookings` | session | 201 `{ booking }`, status `Pending` | 400, 401, 404, 409 |
| PATCH | `/api/bookings/:id` | owner | `{ ok: true }` | 400, 401, 403, 404, 409 |
| POST | `/api/uploads` | session | 201 `{ url, deleteUrl }` | 400, 401, 502, 503 |
| GET/POST | `/api/wishlist` | session | `{ items }` / 201 `{ item }` | 400, 401, 404 |
| DELETE | `/api/wishlist/:studioId` | session | `{ ok: true }` | 400, 401, 404 |
| GET/POST | `/api/studios/:id/reviews` | public / session | `{ reviews }` / 201 `{ review }` | 400, 401, 403, 404, 409 |
| ALL | `/api/auth/*` | – | BetterAuth (sign-up, sign-in, sign-out, get-session, Google callback) | – |

List filters: `?category=Sound%20Stage&q=austin&owner=email&sort=newest|rating|price-asc|price-desc&limit=20`.
`limit` is capped at 100; unknown `sort`/`limit` values fall back to safely.

### Challenge 1 — HttpOnly session cookie

- `/api/auth/*` is handled by BetterAuth's Node adapter, mounted **before** `express.json()`
  (it reads the raw request body itself).
- `requireAuth` resolves the session from the `better-auth.session_token` HttpOnly cookie;
  no session → `401 {"error":"Unauthorized"}`.
- Both apps share the same MongoDB database and `BETTER_AUTH_SECRET`, so a cookie issued by
  the Next.js app on `:3000` is accepted here on `:5000`. Verified live: sign-in through
  Next → `GET /api/bookings` 200, `POST /api/studios` 201; no cookie → 401.

### Challenge 2 — double-booking prevention

Before inserting, `POST /api/bookings` loads active reservations
(`status: { $in: ["Pending","Confirmed"] }`) for the same `studioId` + `date` and rejects any
overlapping `[startTime, startTime + durationHours)` window with `409` and a readable message.
(Pending is included deliberately: otherwise two clients could both book the same slot before
a host ever confirms one.)

### Verified

- `npm run check` — `node --check` on every source file.
- `npm run smoke` — **45/45 passing** (401s, sign-up/sign-in, validation payloads, CRUD,
  ownership 403s, 409 overlap, own-bookings scope, cancel rules, filters, featured ≤ 6).
- CORS preflight/credentialed responses for `Origin: http://localhost:3000`.
- Cross-server session reuse (cookie from Next accepted here).

---

## Run it locally

```bash
# 1. MongoDB — shared with the frontend app (data lives in its .mongodb-data/)
cd ../cat_harry_fontend && npm run db:start      # npm run db:stop to shut it down

# 2. API
cd ../cat_harry_backend
cp .env.example .env     # first time only; then fill BETTER_AUTH_SECRET
npm install
npm run dev              # http://localhost:5000  (node --watch index.js)

# 3. Verify (server + mongod must be running; smoke.sh needs curl, jq, mongosh)
npm run check
npm run smoke
```

---

## Remaining tasks (in order)

### 1. Point the frontend at this API (blocking)

**Option A — Next.js rewrites (recommended).** Same-origin requests, so the HttpOnly
cookie, `credentials`, CORS and cookies on POST all keep working unchanged.

1. `cat_harry_fontend/next.config.mjs` proxies API routes to Express. Set `API_URL` in
   `cat_harry_fontend/.env.local` (default `http://localhost:5000`):

   ```js
   API_URL=http://localhost:5000
   ```

2. Hard-reload a private route (`/my-listings`) while logged in: it must stay on the page
   (rule 5) and the data must come from the Express log, not from Next.

**Option B — direct cross-origin calls.** Add `NEXT_PUBLIC_API_URL`, change every
`fetch("/api/...")` to `${base}/api/...` with `credentials: "include"`, and add the client
origin to the API's `CLIENT_ORIGINS`. Caveat: BetterAuth's cookie is `SameSite=Lax`, so
browsers will **not** send it on cross-site `POST/PUT/PATCH/DELETE`; you would also need
`advanced.defaultCookieAttributes.sameSite = "none"` (HTTPS only) or a proxy. Option A avoids this.

> `cat_harry_fontend/src/data/studios.js` reads MongoDB directly for server components
> (`/` featured, `/studios`, `/studios/[id]`). It keeps working either way; only switch it to
> `fetch(API_URL)` if you want a single data path.

### 2. Auth and image upload configuration

- Express owns `/api/auth`; set `BETTER_AUTH_URL` to the public client origin so origin checks
  and OAuth callbacks use the browser-facing URL.
- Keep `BETTER_AUTH_SECRET` byte-identical in both `.env` files.
- Add an imgbb API key as `IMGBB_API_KEY` in the backend `.env` to enable authenticated image
  uploads. The key is never sent to the browser.

### 3. Google OAuth (needed for real social login)

1. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (or the supported
   `BETTER_AUTH_GOOGLE_*` aliases) in the backend `.env`.
2. In Google Cloud Console → Credentials, add authorized origin `http://localhost:3000` and
   redirect URI `http://localhost:3000/api/auth/callback/google` (+ the production pair later).
3. Restart both servers and test: Login → *Continue with Google* → back on `/` with avatar.

### 4. Deploy

**API → Render**

- Root directory `Milestone-8/assignment-8/cat_harry_backend`; build `npm install`;
  start `npm start`; health check path `/api/health`.
- Env: `MONGODB_URI` (Atlas string **with the db name in the path**, e.g.
  `mongodb+srv://…/studiospace?retryWrites=true`), `BETTER_AUTH_SECRET` (same as client),
  `BETTER_AUTH_URL` (public client origin), `CLIENT_ORIGINS` (client origin), `GOOGLE_*`.
  `PORT` is injected by Render. `trust proxy` is already set for Render's TLS proxy.
- Atlas: allow-list Render egress, create database `studiospace`.

**Client → Vercel**

- Set `API_URL=https://<render-service>.onrender.com` (used by the rewrites from step 1).
- Set `BETTER_AUTH_SECRET` and Google vars to the same values as before.

**Post-deploy checks**

- Logged in → hard reload `/my-listings` and `/my-bookings` → no bounce to `/login`.
- `curl https://<api>/api/health` → `{ "ok": true, "db": "up" }`.
- `curl -X POST https://<api>/api/studios` without cookie → `401`.
- Book the same slot twice → second request `409`.

### 5. Verification checklist

- [ ] `npm run check && npm run smoke` (45/45)
- [ ] Sign in on the client, then `GET <api>/api/bookings` with that cookie → own rows, 200
- [ ] Unauthenticated mutation → 401; editing/deleting someone else's studio → 403
- [ ] Overlapping booking → 409; cancelling a confirmed booking → 409
- [ ] `GET /api/studios/featured` → ≤ 6 rows; category filter returns only that category
- [ ] Frontend `npm run lint && npm run build` still pass after the switch

### 6. Server commits (rubric: ≥ 8 server-side commits)

`cat_harry_backend` is its own git repo with **1** commit (`feat: Start to build backend.`);
all current work is uncommitted. Suggested split — stage explicit paths only:

1. `chore: add express/dotenv/better-auth deps and scripts`
2. `feat: mongo client + lazy env config`
3. `feat: better-auth session middleware on httpOnly cookie (challenge 1)`
4. `feat: studios CRUD routes with validation and owner checks`
5. `feat: featured endpoint and list filters`
6. `feat: bookings routes with overlap prevention (challenge 2)`
7. `feat: cors, health check and central error handling`
8. `test: curl smoke suite` + `docs: backend.md and .env.example`

### 7. Optional / deployment work remaining

- **PDF booking invoice** for confirmed bookings.
- Rate limiting / request logging for the deployed API.

Image upload requires `IMGBB_API_KEY` in the backend environment. Without it the endpoint
returns a clear 503 and the rest of the API remains available.

---

## Gotchas

- `BETTER_AUTH_SECRET` **and** the database must match the client, or cross-app sessions fail
  with 401 for no obvious reason.
- BetterAuth's handler must stay mounted before `express.json()`; it reads the raw body.
- `GET /api/studios/featured` is registered before `GET /api/studios/:id` — keep that order.
- The database name comes from the URI path (`/studiospace`), same rule as the client; an Atlas
  URI without a path would silently use `test`.
- `MONGODB_USER` / `MONGODB_Pass` in `.env` are unused leftovers from another module — only
  `MONGODB_URI` is read.
- Express 5 forwards rejected async handlers to the error middleware, so routes do not need
  try/catch; Mongo connection errors become `503`, malformed JSON becomes `400`.
- The overlap rule includes `Pending` (not just `Confirmed` as written in the brief) on purpose.
