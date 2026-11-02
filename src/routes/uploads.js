import { Router } from "express";
import { requireAuth } from "../auth.js";
import { ApiError } from "../errors.js";
import { getImgbbApiKey } from "../env.js";

export const uploadsRouter = Router();

// Accept a data URL and proxy it to imgbb so the provider key stays server-side.
uploadsRouter.post("/", requireAuth, async (req, res) => {
  const apiKey = getImgbbApiKey();
  if (!apiKey) throw new ApiError(503, "Image uploads are not configured.");

  const image = req.body?.image;
  const match = typeof image === "string" && image.match(/^data:image\/(png|jpe?g|webp|gif);base64,([\s\S]+)$/i);
  if (!match) throw new ApiError(400, "Choose a PNG, JPG, WebP, or GIF image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new ApiError(400, "Image must be smaller than 5 MB.");

  const form = new FormData();
  form.set("image", match[2]);
  let response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      body: form,
    });
  } catch {
    throw new ApiError(502, "Image upload failed. Please try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.success || !result?.data?.url)
    throw new ApiError(502, "Image upload failed. Please try again.");
  res.status(201).json({ url: result.data.url, deleteUrl: result.data.delete_url });
});
