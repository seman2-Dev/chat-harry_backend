# StudioSpace API — backend instructions

Express 5 (ESM) + `mongodb` driver + better-auth Node adapter. Entry: `index.js` → `createApp()` → `listen`.

## Commands

```bash
cp .env.example .env && npm install
npm run dev         # :5000 (`node --watch`)
npm run check       # node --check on all source files
npm run smoke       # 45-assertion curl suite; needs mongod + server running; needs curl, jq, mongosh
```

## Env / infra gotchas

- Both apps must share the same MongoDB DB (`MONGODB_URI` path `/studiospace`) and the same `BETTER_AUTH_SECRET`.
- Backend `.env` has unused `MONGODB_USER` / `MONGODB_Pass` leftovers; only `MONGODB_URI` is read.

## Gotchas

- BetterAuth handles `/api/auth/*` before `express.json()`; `/api/studios/featured` before `/api/studios/:id`; Express 5 forwards rejected async handlers to the error middleware (no try/catch needed); overlap check includes `Pending`; Mongo errors → 503, bad JSON → 400.

## Docs

- API surface / design / remaining tasks: `backend.md` in this folder.
