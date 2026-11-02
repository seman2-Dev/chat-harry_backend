import { ObjectId } from "mongodb";
import { ApiError } from "./errors.js";

export function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// User input lands in $regex — escape it so queries cannot be hijacked.
export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same rules and messages as cat_harry_fontend/src/app/api/studios/route.js
// so the form renders identical field errors whichever server answers.
export function validateStudio(body) {
  const {
    title,
    category,
    hourlyRate,
    securityDeposit,
    maxCapacity,
    location,
    imageUrl,
    amenities,
    overview,
  } = body ?? {};

  const errors = {};
  if (typeof title !== "string" || !title.trim()) errors.title = "Title is required.";
  if (typeof category !== "string" || !category.trim()) errors.category = "Category is required.";
  if (!Number.isFinite(Number(hourlyRate)) || !(Number(hourlyRate) > 0))
    errors.hourlyRate = "Hourly rate must be greater than 0.";
  if (!Number.isInteger(Number(maxCapacity)) || !(Number(maxCapacity) >= 1))
    errors.maxCapacity = "Max capacity must be at least 1.";
  if (typeof location !== "string" || !location.trim()) errors.location = "Location is required.";
  if (typeof imageUrl !== "string" || !imageUrl.trim()) errors.imageUrl = "Image URL is required.";
  if (typeof overview !== "string" || overview.trim().length < 20)
    errors.overview = "Overview must be at least 20 characters.";
  if (securityDeposit !== undefined && (!Number.isFinite(Number(securityDeposit)) || Number(securityDeposit) < 0))
    errors.securityDeposit = "Security deposit must be 0 or greater.";

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, "Validation failed.", errors);
  }

  return {
    title: title.trim(),
    category: category.trim(),
    hourlyRate: Number(hourlyRate),
    securityDeposit: Number(securityDeposit) || 0,
    maxCapacity: Number(maxCapacity),
    location: location.trim(),
    imageUrl: imageUrl.trim(),
    amenities: Array.isArray(amenities) ? amenities.filter(Boolean) : [],
    overview: overview.trim(),
  };
}

export function validateBooking(body) {
  const { studioId, date, startTime, durationHours } = body ?? {};

  const errors = {};
  if (typeof studioId !== "string" || !studioId.trim()) errors.studioId = "Studio is required.";
  const parsedDate = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : null;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsedDate?.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) errors.date = "Pick a valid date.";
  if (
    typeof startTime !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)
  )
    errors.startTime = "Pick a start time.";
  const hours = Number(durationHours);
  if (!(hours >= 1 && hours <= 12))
    errors.durationHours = "Duration must be between 1 and 12 hours.";

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, "Validation failed.", errors);
  }

  return { studioId, date, startTime, durationHours: hours };
}
