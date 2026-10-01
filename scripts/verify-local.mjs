import fs from "node:fs";
import path from "node:path";
function files(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(root, e.name))
        : [path.join(root, e.name)],
    );
}
const forbidden =
  /\b(?:fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|sendBeacon\s*\(|reqwest::|tauri_plugin_http|tauri_plugin_shell)/;
for (const file of [
  ...files("src"),
  ...files("src-tauri/src"),
  ...files("Engine").filter((file) => !file.endsWith(".test.ts")),
]) {
  if (forbidden.test(fs.readFileSync(file, "utf8")))
    throw Error(`Network / shell API found: ${file}`);
}
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (
  !config.app.security.csp ||
  /https?:\s|https?:\*|connect-src[^;]*https:/.test(config.app.security.csp)
)
  throw Error("CSP allows remote connections");
const caps = JSON.parse(
  fs.readFileSync("src-tauri/capabilities/default.json", "utf8"),
);
if (
  caps.permissions.some((p) =>
    /^(fs|http|shell):/.test(typeof p === "string" ? p : p.identifier),
  )
)
  throw Error("Broad filesystem, shell or network permission");
for (const file of files("public"))
  if (/\.(run|save)$|(?:^|\/)dataset\.json$/.test(file))
    throw Error(`Private save in public assets: ${file}`);
for (const file of files("public").filter((file) => file.endsWith(".json"))) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    value &&
    typeof value === "object" &&
    Array.isArray(value.runs) &&
    ("progress" in value || "source" in value)
  )
    throw Error(`User dataset in public assets: ${file}`);
}
console.log("Local architecture and packaged asset audit passed");
