import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function engineFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? engineFiles(file)
      : /\.(?:ts|js|json)$/.test(file) && !file.endsWith(".test.ts") ? [file] : [];
  });
}
const engineDigest = createHash("sha256").update("desktop-derived-v2");
for (const file of [...engineFiles("Engine"), ...engineFiles("src/worker"),
  "src/services/dataset.ts", "src/services/arenaExport.ts", "src/services/summary.ts",
  "src-tauri/src/storage_cache.rs",
].sort()) engineDigest.update(file).update(readFileSync(file));

export default defineConfig(({ mode }) => ({
  base: mode === "web" ? "./" : "/",
  plugins: [react(), tailwindcss(), ...(mode === "web" ? [{
    name: "web-data-policy",
    transformIndexHtml: () => [{ tag: "meta", injectTo: "head-prepend" as const,
      attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'" } }],
  }] : [])],
  define: { __STATS_ENGINE_VERSION__: JSON.stringify(engineDigest.digest("hex")), __STATS_WEB_BUILD__: JSON.stringify(mode === "web") },
  server: { host: "127.0.0.1", port: 1420, strictPort: true, proxy: { "/api/v1": "http://127.0.0.1:18765" } },
  build: { target: "esnext", outDir: mode === "web" ? "dist-web" : "dist" },
  worker: { format: "es" },
  test: {
    include: ["Engine/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    maxWorkers: 4,
  },
}));
