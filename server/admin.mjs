import { openDatabase, createInvite } from "./database.mjs";
import { backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const [command, argument] = process.argv.slice(2);
const db = openDatabase(process.env.STS_DATABASE ?? ".local-build/sync-dev/sync.sqlite");
try {
  if (command === "invite") console.log(createInvite(db, Number(argument ?? 72)));
  else if (command === "backup") {
    const directory = path.join(path.dirname(process.env.STS_DATABASE), "backups");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
    await backup(db, file);
    fs.chmodSync(file, 0o600);
    const entries = fs.readdirSync(directory).filter((name) => /^\d{4}-\d{2}-\d{2}T[\d.Z-]+\.sqlite$/.test(name)).sort().reverse();
    for (const name of entries.slice(7)) fs.unlinkSync(path.join(directory, name));
    console.log("Private backup completed");
  }
  else if (command === "revoke-sessions" && argument) {
    db.prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=?)").run(argument.toLowerCase());
    console.log("Sessions revoked");
  } else throw Error("Usage: admin.mjs invite [valid-hours] | revoke-sessions <username> | backup");
} finally { db.close(); }
