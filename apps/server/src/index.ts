import { fileURLToPath } from "node:url";
import { createServer } from "./app.js";
import { loadConfig } from "./config.js";

// Repo-root .env when present (src/ and dist/ sit at the same depth); real env vars win.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const config = loadConfig();

const { app } = await createServer({ config, logger: true });
await app.listen({ port: config.PORT, host: "0.0.0.0" });
