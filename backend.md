# Backend — StudioSpace API (Express + MongoDB)

`cat_harry_backend` is the server half of assignment 8: Express 5 (ESM) + the `mongodb`
driver + BetterAuth (Node adapter). Its response contract mirrors the Next.js route
handlers the client already calls (`{ studio }`, `{ studios }`, `{ error, fields }`, same
status codes), so moving the client onto it is configuration, not a rewrite.

**Current state:** the frontend proxies its `/api/*` auth, studio, booking, upload, and
wishlist requests to this Express service. Home, explore, and studio detail/edit pages
fetch studio data from this API on the server. Both apps use the same database and BetterAuth secret. Frontend and backend have Vercel deployments; configure their production environment variables as described below.

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

### JWT access tokens for protected mutations

The backend also enables Better Auth's JWT plugin. The browser uses the existing session
cookie to request a short-lived EdDSA JWT from `/api/auth/token`; public verification keys
are available at `/api/auth/jwks`. The frontend attaches that JWT as a Bearer token for
studio and booking mutations. `requireAuth` verifies its signature against JWKS and checks issuer, audience,
algorithm, expiry, subject, and email. Invalid bearer tokens get 401 and never fall back
to cookie auth. Requests with no bearer token still use the Better Auth session cookie,
so existing clients and sign-in continue to work. JWTs are held in memory only and expire
after 15 minutes. Set `BETTER_AUTH_URL` to exactly the same public origin used as JWT
issuer/audience; the JWT signing keys live in MongoDB alongside Better Auth data.

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

### 1. Frontend API integration (complete)

The frontend uses Next.js rewrites in `next.config.mjs` to proxy same-origin `/api/*`
requests to this Express service. Set `API_URL` in the frontend `.env.local` to
`http://localhost:5000` locally or to the deployed API URL. Server-rendered catalog,
featured, detail, and edit pages fetch the Express studio endpoints directly; mutations
and client-side data use the same-origin rewrites so Better Auth cookies are included.

Studio reads fall back to the local sample catalog when the API is unavailable or empty.
My Listings uses `GET /api/studios?owner=<email>` so the server returns only that host's
listings.

> `cat_harry_frontend/src/data/studios.js` fetches studio data from this API for server
> components (`/` featured, `/studios`, `/studios/[id]`, and `/studios/edit/[id]`). If the API
> is empty or unavailable, it falls back to the local sample catalog.

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

**API → Vercel (Express project)**

- Import the backend Git repository as its own Vercel project and set the project root to
  the repository root. The Express app exports from `index.js`; no `api/index.js`, custom
  build command, or legacy `builds` mapping is needed.
- Set Production environment variables in Vercel: `MONGODB_URI` (Atlas string **with the
  database name in the path**, e.g. `mongodb+srv://…/studiospace?retryWrites=true`),
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://cat-harry-wine.vercel.app`,
  `CLIENT_ORIGINS=https://cat-harry-wine.vercel.app`, `GOOGLE_CLIENT_ID`, and
  `GOOGLE_CLIENT_SECRET`. The backend `.env` file is local and is not deployed.
- Add the deployed function's network access to MongoDB Atlas, then redeploy. The backend
  domain shown in Vercel becomes the frontend's `API_URL`.

**Alternative: API → Render**

- Create a Node web service from the backend repository; build `npm install`, start
  `npm start`, health check `/api/health`.
- Set the same environment variables as above. Render injects `PORT`; the app keeps its
  port listener for this hosting mode.
- Allow the service to connect to MongoDB Atlas and create/use the `studiospace` database.

**Client → Vercel**

- Set `API_URL=https://<backend-domain>` (used by the rewrites in `next.config.mjs`).
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

`cat_harry_backend` currently has **10 commits**, satisfying the minimum of 8. The frontend
repository currently has 17 commits, satisfying its minimum of 15.

### 7. Optional / deployment work remaining

- Saved Studios wishlist API is connected to the frontend studio cards and the private `/saved-studios` page.
- Confirmed bookings have a print-ready receipt in the frontend; users can choose **Save as PDF** in the browser print dialog.
- Consider rate limiting / request logging for the deployed API.

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
