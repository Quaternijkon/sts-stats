import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargo = fs
  .readFileSync("src-tauri/Cargo.toml", "utf8")
  .match(/^version = "([^"]+)"/m)?.[1];
if (pkg.version !== conf.version || pkg.version !== cargo)
  throw Error("package.json / Cargo.toml / tauri.conf.json versions differ");
const ref = process.env.GITHUB_REF;
if (
  ref?.startsWith("refs/tags/v") &&
  ref.slice("refs/tags/v".length) !== pkg.version
)
  throw Error("Tag does not match package version");
console.log(`Version ${pkg.version} is consistent`);
