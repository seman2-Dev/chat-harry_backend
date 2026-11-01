import "dotenv/config";
import { createApp } from "./src/app.js";
import { getPort } from "./src/env.js";

const app = createApp();
const port = getPort();

app.listen(port, () => {
  console.log(`StudioSpace API running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});
