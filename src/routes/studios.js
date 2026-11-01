import { Router } from "express";
import { getDb } from "../db.js";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { toObjectId, escapeRegex, validateStudio } from "../validate.js";

export const studiosRouter = Router();

const DEFAULT_SORT = { createdAt: -1, rating: -1 };
const SORTS = {
  newest: { createdAt: -1 },
  rating: { rating: -1 },
  "price-asc": { hourlyRate: 1 },
  "price-desc": { hourlyRate: -1 },
};
const MAX_LIMIT = 100;

// GET /api/studios — public catalog with optional filters.
// ?category=Photo Studio&q=austin&owner=email&sort=price-asc&limit=20
studiosRouter.get("/", async (req, res) => {
  const filter = {};
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const owner = typeof req.query.owner === "string" ? req.query.owner : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (category) filter.category = category;
  if (owner) filter.ownerEmail = owner;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ title: rx }, { location: rx }, { category: rx }];
  }

  const sortKey = typeof req.query.sort === "string" ? req.query.sort : "";
  const sort = Object.hasOwn(SORTS, sortKey) ? SORTS[sortKey] : DEFAULT_SORT;

  const requestedLimit = Number(req.query.limit);
  const limit =
    typeof req.query.limit !== "undefined" &&
    Number.isFinite(requestedLimit) &&
    requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : MAX_LIMIT;

  const studios = await getDb()
    .collection("studios")
    .find(filter)
    .sort(sort)
    .limit(limit)
    .toArray();

  res.json({ studios });
});

// GET /api/studios/featured — Home page section: newest / top-rated, .limit(6).
// Must be registered before "/:id" or "featured" is read as an id.
studiosRouter.get("/featured", async (req, res) => {
  const studios = await getDb()
    .collection("studios")
    .find({})
    .sort({ createdAt: -1, rating: -1 })
    .limit(6)
    .toArray();

  res.json({ studios });
});

// GET /api/studios/:id — full details.
studiosRouter.get("/:id", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw new ApiError(400, "Invalid studio id.");

  const studio = await getDb().collection("studios").findOne({ _id });
  if (!studio) throw new ApiError(404, "Studio not found.");

  res.json({ studio });
});

// POST /api/studios — Challenge 1: session cookie required (401 otherwise).
studiosRouter.post("/", requireAuth, async (req, res) => {
  const data = validateStudio(req.body);

  const doc = {
    ...data,
    ownerEmail: req.session.user.email,
    ownerName: req.session.user.name,
    rating: null,
    reviewCount: 0,
    createdAt: new Date(),
  };

  const result = await getDb().collection("studios").insertOne(doc);
  res.status(201).json({ studio: { ...doc, _id: result.insertedId } });
});

// PUT /api/studios/:id — owner-only update (403 for someone else's listing).
studiosRouter.put("/:id", requireAuth, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw new ApiError(400, "Invalid studio id.");

  const data = validateStudio(req.body);

  const collection = getDb().collection("studios");
  const existing = await collection.findOne({ _id });
  if (!existing) throw new ApiError(404, "Studio not found.");
  if (existing.ownerEmail !== req.session.user.email) {
    throw new ApiError(403, "You can only edit your own studios.");
  }

  const update = { ...data, updatedAt: new Date() };
  await collection.updateOne({ _id }, { $set: update });

  res.json({ studio: { ...existing, ...update } });
});

// DELETE /api/studios/:id — owner-only, confirmation modal lives in the UI.
studiosRouter.delete("/:id", requireAuth, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw new ApiError(400, "Invalid studio id.");

  const collection = getDb().collection("studios");
  const existing = await collection.findOne({ _id });
  if (!existing) throw new ApiError(404, "Studio not found.");
  if (existing.ownerEmail !== req.session.user.email) {
    throw new ApiError(403, "You can only delete your own studios.");
  }

  await collection.deleteOne({ _id });
  res.json({ ok: true });
});
