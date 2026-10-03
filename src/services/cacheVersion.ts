declare const __STATS_ENGINE_VERSION__: string;

// Vite hashes the engine, localization and worker implementation during CI builds.
export const ENGINE_VERSION = typeof __STATS_ENGINE_VERSION__ === "string"
  ? __STATS_ENGINE_VERSION__ : "synthetic-tests";
