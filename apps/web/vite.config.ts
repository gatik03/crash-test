import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const server = "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": server, "/shop": server } },
});
