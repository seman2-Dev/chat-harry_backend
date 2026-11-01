import { Router } from "express";
import { getDb } from "../db.js";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { toObjectId } from "../validate.js";

export const wishlistRouter = Router();

wishlistRouter.use(requireAuth);

wishlistRouter.get("/", async (req, res) => {
  const items = await getDb().collection("wishlists")
    .find({ userEmail: req.session.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ items });
});

wishlistRouter.post("/", async (req, res) => {
  const studioId = typeof req.body?.studioId === "string" ? req.body.studioId : "";
  const _id = toObjectId(studioId);
  if (!_id) throw new ApiError(400, "Invalid studio id.");
  const db = getDb();
  const studio = await db.collection("studios").findOne({ _id });
  if (!studio) throw new ApiError(404, "Studio not found.");
  const item = {
    userEmail: req.session.user.email,
    studioId,
    createdAt: new Date(),
    studio: {
      _id: studio._id,
      title: studio.title,
      imageUrl: studio.imageUrl,
      category: studio.category,
      hourlyRate: studio.hourlyRate,
      location: studio.location,
      rating: studio.rating,
    },
  };
  await db.collection("wishlists").updateOne(
    { userEmail: item.userEmail, studioId },
    { $setOnInsert: item },
    { upsert: true }
  );
  res.status(201).json({ item });
});

wishlistRouter.delete("/:studioId", async (req, res) => {
  const _id = toObjectId(req.params.studioId);
  if (!_id) throw new ApiError(400, "Invalid studio id.");
  const result = await getDb().collection("wishlists").deleteOne({
    userEmail: req.session.user.email,
    studioId: req.params.studioId,
  });
  if (!result.deletedCount) throw new ApiError(404, "Saved studio not found.");
  res.json({ ok: true });
});
