import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.mjs";
import { createServer } from "./app.mjs";

const db = openDatabase(process.env.STS_DATABASE ?? ".local-build/sync-dev/sync.sqlite");
const port = Number(process.env.STS_PORT ?? 18765);
const server = createServer({ db,
  webRoot: process.env.STS_WEB_ROOT ?? fileURLToPath(new URL("../dist-web/", import.meta.url)),
  origin: process.env.STS_ORIGIN ?? `http://127.0.0.1:${port}`,
  secureCookies: process.env.STS_INSECURE_LOCAL !== "1",
  trustProxy: process.env.STS_TRUST_PROXY === "1",
});
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.listen(port, process.env.STS_BIND ?? "127.0.0.1", () => console.log(`STS2Stats service listening on port ${port}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
