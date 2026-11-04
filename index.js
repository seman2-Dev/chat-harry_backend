import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { jwt } from "better-auth/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = Number(process.env.PORT);
const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db();
const publicFrontendUrl = "https://cat-harry-wine.vercel.app";
const configuredAuthUrl = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, "");

const authUrl =
  process.env.VERCEL && (!configuredAuthUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(configuredAuthUrl))
    ? publicFrontendUrl
    : configuredAuthUrl;
const origins =[
  ...new Set([
    ...(process.env.CLIENT_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    authUrl,
    publicFrontendUrl,
  ]),
];
const googleId = process.env.GOOGLE_CLIENT_ID || process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;

const auth = betterAuth( {
  baseURL: authUrl,
  trustedOrigins: origins,
  database: mongodbAdapter(db),
  emailAndPassword: { enabled: true, minPasswordLength: 6, autoSignIn: false },
  account: { accountLinking: { trustedProviders: ["google"] } },
  socialProviders: googleId && googleSecret ? { google: { clientId: googleId, clientSecret: googleSecret } } : undefined,
  plugins: [jwt({ jwt: { issuer: authUrl, audience: authUrl, expirationTime: "15m", definePayload: ({ user }) => ({ sub: user.id, email: user.email, name: user.name }) } })],
});
const JWKS = createRemoteJWKSet(new URL("/api/auth/jwks", authUrl));

app.use(cors({ origin: origins, credentials: true }));
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json({ limit: "7mb" }));

const verifyToken = async(req, res, next) =>{
  try {
    if (req.headers.authorization) {
      const token = req.headers.authorization.split(" ")[1];
      const { payload } = await jwtVerify(token, JWKS, { issuer: authUrl, audience: authUrl, algorithms: ["EdDSA"] });
      req.user = { id: payload.sub, email: payload.email, name: payload.name || "" };
    } else {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return res.status(401).json({ error: "Unauthorized" });
      req.user = session.user;
    }

    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
};

app.get("/", (req, res) => res.json({ name: "StudioSpace API", ok: true }));
app.get("/api/health", async (req, res) => {
  try { await db.command({ ping: 1 }); res.json({ ok: true, db: "up" }); }
  catch { res.status(503).json({ ok: false, db: "down" }); }
});

// ========================= CRUD Operations ============================
app.get("/api/studios/featured", async (req, res) => {
  res.json({ studios: await db.collection("studios").find().sort({ createdAt: -1 }).limit(6).toArray() });
});

app.get("/api/studios", async(req, res) => {
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.owner) filter.ownerEmail = req.query.owner;
  if (req.query.q) filter.$or = ["title", "location", "category"].map((key) => ({ [key]: new RegExp(String(req.query.q), "i") }));

  const sort = { newest: { createdAt: -1 }, rating: { rating: -1 }, "price-asc": { hourlyRate: 1 }, "price-desc": { hourlyRate: -1 } };
  res.json({ studios: await db.collection("studios").find(filter).sort(sort[req.query.sort] || { createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 100)).toArray() });
});

app.get("/api/studios/:id", async (req, res) => res.json({ studio: await db.collection("studios").findOne({ _id: new ObjectId(req.params.id) }) }));

app.post("/api/studios", verifyToken, async (req, res) => {
  const studio = { ...req.body, ownerEmail: req.user.email, ownerName: req.user.name, rating: null, reviewCount: 0, createdAt: new Date() };
  const result = await db.collection("studios").insertOne(studio);
  res.status(201).json({ studio: { ...studio, _id: result.insertedId } });
});

app.put("/api/studios/:id", 
  verifyToken, 
  async (req, res)=> {
  const _id = new ObjectId(req.params.id), collection = db.collection("studios"), old = await collection.findOne({ _id });
  if (!old || old.ownerEmail !== req.user.email) return res.status(old ? 403 : 404).json({ error: "Studio not found or not yours." });

  await collection.updateOne({ _id }, { $set: req.body });
  res.json({ studio: { ...old, ...req.body } });
});

app.delete("/api/studios/:id", 
  verifyToken, async (req, res) => {
  const _id = new ObjectId(req.params.id), studio = await db.collection("studios").findOne({ _id });
  if (!studio || studio.ownerEmail !== req.user.email) return res.status(studio ? 403 : 404).json({ error: "Studio not found or not yours." });
  await db.collection("studios").deleteOne({ _id }); res.json({ ok: true });
});


// =============================== Bookings and slot overlap check =========================
app.get("/api/bookings", 
  verifyToken, 
  async (req, res) =>{
  const email = req.user.email;
  const hosts = (await db.collection("studios").find({ ownerEmail: email }).toArray()).map((x) => String(x._id));
  const bookings = await db.collection("bookings").find({ $or: [{ userEmail: email }, { studioId: { $in: hosts } }] }).sort({ createdAt: -1 }).toArray();
  res.json({ bookings: bookings.map((x) => ({ ...x, isHost: hosts.includes(x.studioId) })) });
});

app.post("/api/bookings", 
  verifyToken, 
  async (req, res) =>{
  const { studioId, date, startTime, durationHours, note, studioSnapshot = {} } = req.body;
  const studio = await db.collection("studios").findOne({ _id: ObjectId.isValid(studioId) ? new ObjectId(studioId) : null });

  const rate = Number(studio?.hourlyRate || studioSnapshot.hourlyRate || 0);
  const booking = { studioId, studioTitle: studio?.title || studioSnapshot.title, studioImage: studio?.imageUrl || studioSnapshot.image, studioLocation: studio?.location || studioSnapshot.location, hourlyRate: rate, date, startTime, durationHours: Number(durationHours), totalPrice: rate * Number(durationHours), note, status: "Pending", userEmail: req.user.email, userName: req.user.name, createdAt: new Date() };
  const rows = await db.collection("bookings").find({ studioId, date, status: { $in: ["Pending", "Confirmed"] } }).toArray();

  const mins =(t) => t.split(":").reduce((h, m) => Number(h) * 60 + Number(m));
  if (rows.some((x) => mins(startTime) < mins(x.startTime) + x.durationHours * 60 && mins(x.startTime) < mins(startTime) + Number(durationHours) * 60)) return res.status(409).json({ error: "That time slot is already booked." });
  const result = await db.collection("bookings").insertOne(booking);
  res.status(201).json({ booking: { ...booking, _id: result.insertedId } });
});

app.patch("/api/bookings/:id", 
  verifyToken, 
  async (req, res)=> {
  const _id = new ObjectId(req.params.id), booking = await db.collection("bookings").findOne({ _id }), status = req.body.status;
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (!["Cancelled", "Confirmed", "Completed"].includes(status)) return res.status(400).json({ error: "Invalid booking status." });
  const studio = await db.collection("studios").findOne({ _id: new ObjectId(booking.studioId) });
  if (status === "Cancelled" && booking.userEmail !== req.user.email) return res.status(403).json({ error: "Not your booking." });
  if (status === "Cancelled" && booking.status !== "Pending") return res.status(409).json({ error: "Only pending bookings can be cancelled." });
  if (status !== "Cancelled" && studio?.ownerEmail !== req.user.email) return res.status(403).json({ error: "Only the host can update this booking." });
  if (status === "Confirmed" && booking.status !== "Pending" || status === "Completed" && booking.status !== "Confirmed") return res.status(409).json({ error: "Booking status cannot be changed." });
  await db.collection("bookings").updateOne({ _id }, { $set: { status, updatedAt: new Date() } }); res.json({ ok: true });
});


// =================== Reviews, saved studios, and image upload ==========================
app.get("/api/studios/:id/reviews", async(req, res) => res.json({ reviews: await db.collection("reviews").find({ studioId: req.params.id }).sort({ createdAt: -1 }).toArray() }));

app.post("/api/studios/:id/reviews", verifyToken, async (req, res) => {
  const review = { studioId: req.params.id, userEmail: req.user.email, userName: req.user.name, rating: Number(req.body.rating), text: req.body.text, createdAt: new Date() };
  const result = await db.collection("reviews").insertOne(review);
  res.status(201).json({ review: { ...review, _id: result.insertedId } });
});

app.get("/api/wishlist", 
  verifyToken, 
  async(req, res) => res.json({ items: await db.collection("wishlists").find({ userEmail: req.user.email }).toArray() }));
app.post("/api/wishlist", verifyToken, async (req, res) => {
  const studioId = req.body.studioId, studio = await db.collection("studios").findOne({ _id: new ObjectId(studioId) });
  const item = { userEmail: req.user.email, studioId, createdAt: new Date(), studio };
  await db.collection("wishlists").updateOne({ userEmail: item.userEmail, studioId }, { $setOnInsert: item }, { upsert: true });
  res.status(201).json({ item });
});

app.delete("/api/wishlist/:studioId", verifyToken, async (req, res)=> {
  await db.collection("wishlists").deleteOne({ userEmail: req.user.email, studioId: req.params.studioId }); res.json({ ok: true });
});

app.post("/api/uploads", 
  verifyToken, 
  async (req, res) => {
  const form = new FormData(); form.set("image", req.body.image.split(",")[1]);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, { method: "POST", body: form });
  const data = await response.json(); res.status(201).json({ url: data.data.url, deleteUrl: data.data.delete_url });
});


export default app;
if (process.env.VERCEL !== "1") app.listen(PORT, () => console.log(`API running on port ${PORT}`));

app.use((err, req, res, next) =>{
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
});