import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("请使用 pnpm verify");
const steps = [
  ...["check:version", "lint", "typecheck", "test", "verify:local", "build", "build:web", "test:e2e", "test:e2e:web"]
    .map((step) => [process.execPath, [pnpm, step]]),
  ["cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"]],
  ["cargo", ["clippy", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--", "-D", "warnings"]],
  ["cargo", ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]],
];
for (const [command, args] of steps) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd, stdio: "inherit",
    env: { ...process.env, CI: "true", CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
