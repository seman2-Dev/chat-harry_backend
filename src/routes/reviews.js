import { Router } from "express";
import { getDb } from "../db.js";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { toObjectId } from "../validate.js";

export const reviewsRouter = Router({ mergeParams: true });

reviewsRouter.get("/", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw new ApiError(400, "Invalid studio id.");
  const reviews = await getDb().collection("reviews")
    .find({ studioId: req.params.id })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  res.json({ reviews });
});

reviewsRouter.post("/", requireAuth, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw new ApiError(400, "Invalid studio id.");
  const rating = Number(req.body?.rating);
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 8 || text.length > 1200)
    throw new ApiError(400, "Provide a 1–5 star rating and a review between 8 and 1,200 characters.");

  const db = getDb();
  const studio = await db.collection("studios").findOne({ _id });
  if (!studio) throw new ApiError(404, "Studio not found.");
  const booking = await db.collection("bookings").findOne({
    studioId: req.params.id,
    userEmail: req.session.user.email,
    status: "Completed",
  });
  if (!booking) throw new ApiError(403, "Complete a booking at this studio before reviewing it.");
  const reviews = db.collection("reviews");
  const existing = await reviews.findOne({ studioId: req.params.id, userEmail: req.session.user.email });
  if (existing) throw new ApiError(409, "You have already reviewed this studio.");

  const review = {
    studioId: req.params.id,
    userEmail: req.session.user.email,
    userName: req.session.user.name,
    rating,
    text,
    createdAt: new Date(),
  };
  const result = await reviews.insertOne(review);
  const all = await reviews.find({ studioId: req.params.id }).toArray();
  const average = all.reduce((sum, item) => sum + item.rating, 0) / all.length;
  await db.collection("studios").updateOne(
    { _id },
    { $set: { rating: Number(average.toFixed(1)), reviewCount: all.length } }
  );
  res.status(201).json({ review: { ...review, _id: result.insertedId }, rating: Number(average.toFixed(1)), reviewCount: all.length });
});
