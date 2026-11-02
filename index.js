import "dotenv/config";
import { createApp } from "./src/app.js";
import { getPort } from "./src/env.js";

const app = createApp();
export default app;

// Vercel invokes the exported Express app as a function. Keep the port listener
// for local Node development and Render-style long-running services.
if (process.env.VERCEL !== "1") {
  const port = getPort();
  app.listen(port, () => {
    console.log(`StudioSpace API running on http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);
  });
}
