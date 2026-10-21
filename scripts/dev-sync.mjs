process.env.STS_INSECURE_LOCAL = "1";
process.env.STS_ORIGIN = "http://127.0.0.1:1420";
await import("../server/main.mjs");
