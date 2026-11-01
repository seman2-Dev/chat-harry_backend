import { Router } from "express";
import { getDb } from "../db.js";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { toObjectId, validateBooking } from "../validate.js";

export const bookingsRouter = Router();

// Bookings store date (YYYY-MM-DD) + startTime ("HH:MM") + durationHours.
// Two bookings collide when their [start, end) windows overlap on one day.
function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(existing, next) {
  if (existing.date !== next.date) return false;
  if (existing.studioId !== next.studioId) return false;
  const nextStart = toMinutes(next.startTime);
  const nextEnd = nextStart + next.durationHours * 60;
  const existingStart = toMinutes(existing.startTime);
  const existingEnd = existingStart + existing.durationHours * 60;
  return nextStart < existingEnd && existingStart < nextEnd;
}

// GET /api/bookings — only the signed-in user's reservations.
bookingsRouter.get("/", requireAuth, async (req, res) => {
  const db = getDb();
  const hostedStudioIds = (await db.collection("studios")
    .find({ ownerEmail: req.session.user.email }, { projection: { _id: 1 } })
    .toArray()).map((studio) => String(studio._id));
  const rows = await db.collection("bookings")
    .find({ $or: [
      { userEmail: req.session.user.email },
      { studioId: { $in: hostedStudioIds } },
    ] })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  const bookings = rows.map((booking) => ({
    ...booking,
    isHost: hostedStudioIds.includes(booking.studioId),
  }));

  res.json({ bookings });
});

// POST /api/bookings — Challenge 1 (401 without session) + Challenge 2
// (409 when the slot overlaps an active Pending/Confirmed reservation).
bookingsRouter.post("/", requireAuth, async (req, res) => {
  const { studioId, date, startTime, durationHours } = validateBooking(req.body);
  const { totalPrice, note, studioSnapshot } = req.body ?? {};

  const collection = getDb().collection("bookings");
  const _id = toObjectId(studioId);

  // Resolve the studio (DB ObjectId) for pricing + title. Seed/mock studios
  // are not in the DB, so fall back to the client snapshot.
  const studio = _id
    ? await getDb().collection("studios").findOne({ _id })
    : await getDb().collection("studios").findOne({ id: studioId });

  const snapshot = studioSnapshot ?? {};
  const studioTitle = studio?.title || snapshot.title || "Studio";
  const studioImage =
    studio?.imageUrl || snapshot.image || "/images/studios/product-studio.jpg";
  const studioLocation = studio?.location || snapshot.location || "";
  const hourlyRate = Number(studio?.hourlyRate ?? snapshot.hourlyRate) || 0;
  if (!studio && !snapshot.title) throw new ApiError(404, "Studio not found.");

  const booking = {
    studioId,
    studioTitle,
    studioImage,
    studioLocation,
    hourlyRate,
    date,
    startTime,
    durationHours,
    totalPrice: Number(totalPrice) || hourlyRate * durationHours,
    note: typeof note === "string" ? note.slice(0, 500) : "",
    status: "Pending",
    userEmail: req.session.user.email,
    userName: req.session.user.name,
    createdAt: new Date(),
  };

  // Challenge 2: reject collisions with active (Pending/Confirmed) slots.
  const active = await collection
    .find({ status: { $in: ["Pending", "Confirmed"] } })
    .toArray();
  if (active.some((existing) => overlaps(existing, booking))) {
    throw new ApiError(
      409,
      "That time slot is already booked. Please choose different hours."
    );
  }

  const result = await collection.insertOne(booking);
  res.status(201).json({ booking: { ...booking, _id: result.insertedId } });
});

// PATCH /api/bookings/:id — guests may cancel pending bookings; studio hosts
// can confirm pending bookings or mark confirmed bookings completed.
bookingsRouter.patch("/:id", requireAuth, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw new ApiError(400, "Invalid booking id.");

  const nextStatus = req.body?.status;
  if (!["Cancelled", "Confirmed", "Completed"].includes(nextStatus))
    throw new ApiError(400, "Choose a supported booking status.");

  const collection = getDb().collection("bookings");
  const existing = await collection.findOne({ _id });
  if (!existing) throw new ApiError(404, "Booking not found.");
  const studio = await getDb().collection("studios").findOne({
    _id: toObjectId(existing.studioId),
  });
  const isGuest = existing.userEmail === req.session.user.email;
  const isHost = studio?.ownerEmail === req.session.user.email;
  if (nextStatus === "Cancelled") {
    if (!isGuest) throw new ApiError(403, "You can only cancel your own bookings.");
    if (existing.status !== "Pending")
      throw new ApiError(409, "Only pending bookings can be cancelled.");
  } else {
    if (!isHost) throw new ApiError(403, "Only the studio host can update this booking.");
    const allowed = nextStatus === "Confirmed"
      ? existing.status === "Pending"
      : existing.status === "Confirmed";
    if (!allowed) throw new ApiError(409, `Booking cannot move from ${existing.status} to ${nextStatus}.`);
  }

  await collection.updateOne(
    { _id },
    { $set: { status: nextStatus, updatedAt: new Date() } }
  );
  res.json({ ok: true });
});
