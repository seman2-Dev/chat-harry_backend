// Application error with an HTTP status and an optional payload shape
// `{ error, fields }` — the exact contract the frontend already renders.

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

function isMongoError(error) {
  return (
    error &&
    typeof error.name === "string" &&
    (error.name.startsWith("Mongo") || error.name === "MongoNetworkError")
  );
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    });
  }

  // Body parser: client sent malformed JSON.
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  // mongod down / unreachable → same 503 the frontend API routes return.
  if (isMongoError(error)) {
    return res.status(503).json({ error: "Database is unavailable right now." });
  }

  console.error(error);
  return res.status(500).json({ error: "Something went wrong." });
}
