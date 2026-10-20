import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2] ?? (process.platform === "darwin" ? "macos" : "windows");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("请使用 pnpm build:desktop macos|windows");
const env = { ...process.env, CI: "true", CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4" };
const args = ["tauri", "build", "--ci"];
if (target === "macos") {
  if (process.platform !== "darwin") throw Error("macOS 通用构建需要本地 macOS 工具链");
  args.push("--target", "universal-apple-darwin", "--bundles", "app,dmg");
} else if (target === "windows") {
  args.push("--target", "x86_64-pc-windows-msvc");
  const bundles = process.platform === "win32" ? ["nsis", "msi"] : ["nsis"];
  args.push("--config", JSON.stringify({ bundle: { targets: bundles } }));
  if (process.platform !== "win32") {
    args.push("--runner", "cargo-xwin");
    env.XWIN_ARCH ??= "x86_64";
    const llvm = ["/opt/homebrew/opt/llvm/bin", "/opt/homebrew/opt/lld/bin",
      "/usr/local/opt/llvm/bin", "/usr/local/opt/lld/bin"].filter(existsSync);
    if (llvm.length) env.PATH = [...llvm, env.PATH].join(path.delimiter);
  }
} else {
  throw Error("用法：pnpm build:desktop macos|windows");
}
args.push("--", "--locked");
const result = spawnSync(process.execPath, [pnpm, ...args], { cwd, env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
