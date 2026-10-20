import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("请使用 pnpm build:web");
for (const args of [["typecheck"], ["exec", "vite", "build", "--mode", "web"]]) {
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const version = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(cwd, "dist-web", "README.txt"), `STS2Stats ${version} Web\n\nServe this directory over HTTPS or localhost. A site subdirectory is supported.\nAll save processing and browser storage stay on this device. No backend or upload endpoint is needed.\nDirectory synchronization needs a browser with read-only directory authorization; other browsers use manual import.\nExport dataset.json to back up your data before clearing site storage.\n`);
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const root = path.join(cwd, "dist-web");
const entries = Object.fromEntries(files(root).map((file) => [path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file)]));
const output = path.join(cwd, ".local-build", "releases", `v${version}`);
fs.mkdirSync(output, { recursive: true });
const archive = path.join(output, `STS2Stats_${version}_web.zip`);
fs.writeFileSync(archive, zipSync(entries, { level: 6 }));
console.log(`Web static files: dist-web/ (version ${version})`);
console.log(`Web archive: ${archive}`);
