import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const app = buildApp({ logger: true });
await app.listen({ port: config.PORT, host: "0.0.0.0" });
