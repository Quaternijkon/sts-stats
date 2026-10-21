import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../server/database.mjs";
import { createServer } from "../server/app.mjs";

const directory = ".local-build/sync-e2e";
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = openDatabase(path.join(directory, "sync.sqlite"));
const server = createServer({ db, webRoot: path.resolve("dist-web"), origin: "http://127.0.0.1:18766", secureCookies: false });
server.listen(18766, "127.0.0.1", () => console.log("Synthetic sync E2E service ready"));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
