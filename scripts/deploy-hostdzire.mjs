import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const remote = "hostdzire";
const target = "/opt/sts2stats-tauri";
const nodeVersion = "v24.22.1";
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" }, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})${capture ? `: ${result.stderr}` : ""}`);
  return result.stdout?.trim() ?? "";
}
const ssh = (command, capture = false) => run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", remote, command], capture);
const action = process.argv[2] ?? "deploy";
if (action === "status") {
  ssh(`systemctl is-active sts2stats-tauri; readlink ${target}/current; curl --fail --silent --show-error https://sts2stats.quaternijkon.online/api/v1/health`);
} else if (action === "rollback") {
  ssh(`bash ${target}/current/server/ops/activate.sh rollback`);
} else if (action === "invite") {
  const code = ssh(`runuser -u sts2stats-sync -- env STS_DATABASE=/var/lib/sts2stats-tauri/sync.sqlite ${target}/current/runtime/bin/node ${target}/current/server/admin.mjs invite 168`, true);
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw Error("Invite output was invalid");
  const destination = path.join(root, ".local-build", "hostdzire", "account-invite.txt");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, `站点：https://sts2stats.quaternijkon.online\n打开游戏 → 设置 → 使用邀请码注册。\n邀请码（单次使用，7 天有效）：${code}\n设置密码后，在电脑和 Android 浏览器登录同一个账户，点击「启用账户同步」。\n登录本身不会上传数据。退出登录保留本机数据，共用设备请另行清除。\n`, { mode: 0o600 });
  console.log(`Private invitation saved to ${destination}`);
} else if (action === "deploy") {
  if (run("git", ["status", "--porcelain"], true)) throw Error("Commit changes before deployment so the published build has a reproducible source revision");
  const commit = run("git", ["rev-parse", "HEAD"], true);
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw Error("Use pnpm deploy:hostdzire");
  for (const task of ["check:version", "lint", "typecheck", "test", "verify:local", "build:web", "test:e2e:web", "test:e2e:sync"]) run(process.execPath, [pnpm, task]);
  for (const file of ["database.mjs", "app.mjs", "main.mjs", "admin.mjs"]) run(process.execPath, ["--check", `server/${file}`]);
  const runtimeName = `node-${nodeVersion}-linux-x64`;
  const cache = path.join(root, ".local-build", "toolchains");
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `${runtimeName}.tar.xz`);
  const sums = path.join(cache, `${nodeVersion}-SHASUMS256.txt`);
  for (const [file, name] of [[archive, `${runtimeName}.tar.xz`], [sums, "SHASUMS256.txt"]]) {
    if (!fs.existsSync(file)) {
      run("curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "--output", `${file}.download`, `https://nodejs.org/dist/${nodeVersion}/${name}`]);
      fs.renameSync(`${file}.download`, file);
    }
  }
  const expected = fs.readFileSync(sums, "utf8").split("\n").find((line) => line.endsWith(`  ${runtimeName}.tar.xz`))?.split(/\s+/)[0];
  const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (!expected || digest(archive) !== expected) throw Error("Node runtime checksum verification failed");
  if (!fs.existsSync(path.join(cache, runtimeName, "bin", "node"))) run("tar", ["-xJf", archive, "-C", cache]);
  if (run("git", ["rev-parse", "HEAD"], true) !== commit || run("git", ["status", "--porcelain"], true)) throw Error("Source changed during verification; deployment stopped");
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version;
  const release = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z")}-${commit.slice(0, 12)}`;
  const output = path.join(root, ".local-build", "deploy", release);
  const stage = path.join(output, "stage");
  fs.mkdirSync(path.join(stage, "runtime", "bin"), { recursive: true });
  fs.cpSync(path.join(root, "dist-web"), path.join(stage, "web"), { recursive: true });
  fs.cpSync(path.join(root, "server"), path.join(stage, "server"), { recursive: true });
  fs.copyFileSync(path.join(cache, runtimeName, "bin", "node"), path.join(stage, "runtime", "bin", "node"));
  fs.chmodSync(path.join(stage, "runtime", "bin", "node"), 0o755);
  fs.copyFileSync(path.join(cache, runtimeName, "LICENSE"), path.join(stage, "runtime", "LICENSE"));
  const info = { version, commit, release, builtLocally: true, nodeVersion, runtimeSha256: expected, platform: "linux-x64", builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(stage, "BUILD-INFO.json"), JSON.stringify(info, null, 2) + "\n");
  fs.copyFileSync(path.join(stage, "BUILD-INFO.json"), path.join(stage, "web", "build-info.json"));
  const bundle = path.join(output, "site.tar.gz");
  run("tar", ["-czf", bundle, "-C", stage, "."]);
  ssh(`install -d -m 755 ${target}/incoming ${target}/releases; test $(df -Pk ${target} | awk 'NR==2 {print $4}') -gt 524288`);
  run("scp", ["-o", "BatchMode=yes", bundle, `${remote}:${target}/incoming/${release}.tar.gz`]);
  ssh(`test "$(sha256sum ${target}/incoming/${release}.tar.gz | cut -d ' ' -f 1)" = ${quote(digest(bundle))} && mkdir ${target}/releases/${release} && tar -xzf ${target}/incoming/${release}.tar.gz -C ${target}/releases/${release} && bash ${target}/releases/${release}/server/ops/activate.sh deploy ${quote(release)}`);
  console.log(`Deployed https://sts2stats.quaternijkon.online (${version}, ${commit.slice(0, 12)})`);
  console.log("Create a private single-use invitation: pnpm deploy:hostdzire invite");
} else throw Error("Usage: pnpm deploy:hostdzire [deploy|status|rollback|invite]");
