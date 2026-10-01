import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { target: "esnext" },
  worker: { format: "es" },
  test: {
    include: ["Engine/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
