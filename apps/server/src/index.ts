import { createServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const { app } = await createServer({ config, logger: true });
await app.listen({ port: config.PORT, host: "0.0.0.0" });
