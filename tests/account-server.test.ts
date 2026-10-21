import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, createInvite } from "../server/database.mjs";
import { createServer } from "../server/app.mjs";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
async function fixture(maxPayloadBytes = 1024 * 1024) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sts-sync-test-"));
  const db = openDatabase(path.join(root, "sync.sqlite"));
  const server = createServer({ db, webRoot: root, origin: "http://localhost", secureCookies: false, maxPayloadBytes });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/v1`;
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async (route: string, value?: unknown, cookie?: string, method = value === undefined ? "GET" : "POST", extra = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(value !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: value !== undefined ? JSON.stringify(value) : undefined });
    return { status: response.status, value: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
  };
  const register = (username = "synthetic-user") => call("/auth/register", { username, password: "synthetic-password-123", invite: createInvite(db) });
  return { db, call, register };
}
const vault = (revision = 0, marker = "a") => ({ revision, fingerprint: marker.repeat(64), payload: JSON.stringify({ schema: 1, game: "sts2", dataset: { runs: [], source: "", importedAt: 0, progress: null, manifest: {}, fileRunIDs: {} }, favorites: [] }) });

describe("private account and synchronization server", () => {
  it("requires single-use invites, rejects cross-site requests and keeps sessions HttpOnly", async () => {
    const { call, db } = await fixture();
    expect((await call("/vaults")).status).toBe(401);
    const invite = createInvite(db);
    const account = { username: "synthetic-owner", password: "synthetic-password-123", invite };
    expect((await call("/auth/register", { ...account, invite: "invalid" })).status).toBe(403);
    const user = await call("/auth/register", account);
    expect(user.status).toBe(200);
    expect(user.value.token).toBeUndefined();
    expect(user.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    expect((await call("/auth/register", { ...account, username: "synthetic-other" })).status).toBe(403);
    expect((await call("/auth/session", undefined, user.cookie)).value.user.username).toBe(account.username);
    expect((await call("/auth/logout", {}, user.cookie, "POST", { Origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/auth/logout", {}, user.cookie)).status).toBe(200);
    expect((await call("/vaults", undefined, user.cookie)).status).toBe(401);
  });
  it("isolates accounts and games and atomically refuses concurrent stale writes", async () => {
    const { call, register } = await fixture();
    const first = await register(); const second = await register("synthetic-two");
    expect((await call("/vaults/sts2", vault(), first.cookie, "PUT")).status).toBe(200);
    const concurrent = await Promise.all([call("/vaults/sts2", vault(1, "b"), first.cookie, "PUT"), call("/vaults/sts2", vault(1, "c"), first.cookie, "PUT")]);
    expect(concurrent.map((item) => item.status).sort()).toEqual([200, 409]);
    expect((await call("/vaults/sts2", undefined, second.cookie)).status).toBe(404);
    expect((await call("/vaults/sts2", vault(), second.cookie, "PUT", { "X-STS-Account": first.value.user.id })).status).toBe(409);
    expect((await call("/vaults/sts1", undefined, first.cookie)).status).toBe(404);
    expect((await call("/vaults/sts2", undefined, first.cookie)).value.revision).toBe(2);
    expect((await call("/vaults", undefined, first.cookie)).value.vaults).toHaveLength(1);
  });
  it("rotates native sessions, revokes other devices after password changes and deletes all account data", async () => {
    const { call, register, db } = await fixture();
    const first = await register();
    const native = await call("/auth/login", { username: "synthetic-user", password: "synthetic-password-123" }, undefined, "POST", { "X-STS-Client": "desktop" });
    expect(native.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(native.cookie).toBeUndefined();
    const bearer = { Authorization: `Bearer ${native.value.token}` };
    expect((await call("/vaults", undefined, undefined, "GET", bearer)).status).toBe(200);
    expect((await call("/auth/password", { password: "synthetic-password-123", newPassword: "new-synthetic-password" }, first.cookie)).status).toBe(200);
    expect((await call("/vaults", undefined, undefined, "GET", bearer)).status).toBe(401);
    const current = await call("/auth/login", { username: "synthetic-user", password: "new-synthetic-password" });
    await call("/vaults/sts2", vault(), current.cookie, "PUT");
    expect((await call("/auth/delete", { password: "new-synthetic-password" }, current.cookie)).status).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM vaults").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()?.n).toBe(0);
  });
  it("rejects oversized or corrupt uploads without changing the authoritative checkpoint", async () => {
    const { call, register } = await fixture(1024);
    const user = await register();
    expect((await call("/vaults/sts2", vault(), user.cookie, "PUT")).status).toBe(200);
    expect((await call("/vaults/sts2", { ...vault(1), payload: "x".repeat(2000) }, user.cookie, "PUT")).status).toBe(413);
    expect((await call("/vaults/sts2", { ...vault(1), payload: "invalid" }, user.cookie, "PUT")).status).toBe(400);
    expect((await call("/vaults/sts2", undefined, user.cookie)).value.revision).toBe(1);
  });
});
