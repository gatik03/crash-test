import { buildApp } from "./app.js";

// shortcut: raw env read, move to a zod-validated config.ts once M2 adds real settings
const port = Number(process.env.PORT ?? 3000);

const app = buildApp({ logger: true });
await app.listen({ port, host: "0.0.0.0" });
