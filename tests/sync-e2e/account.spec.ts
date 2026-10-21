import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openDatabase, createInvite } from "../../server/database.mjs";
import { normalizeRun } from "../../Engine/domain/parser";

const password = "synthetic-browser-password";
function syntheticDataset(count: number) {
  return { source: "/synthetic/cloud-source", importedAt: 12345, progress: null, manifest: {}, fileRunIDs: {},
    runs: Array.from({ length: count }, (_, index) => normalizeRun({ win: true, start_time: 100 + index, seed: `synthetic-cloud-${index}`, run_time: 600,
      players: [{ id: 1, character: "Ironclad", deck: [], relics: [] }], map_point_history: [] }, `synthetic-${index}.run`)) };
}
async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "切换侧栏", exact: true });
  const button = page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: label, exact: true });
  if (!await button.isVisible()) await toggle.click();
  // A sidebar can be outside the viewport while CSS still reports it visible.
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await button.click();
}
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await navigate(page, "设置");
}
async function register(page: Page) {
  const db = openDatabase(".local-build/sync-e2e/sync.sqlite");
  const invite = createInvite(db); db.close();
  const username = `synthetic-${randomUUID().slice(0, 12)}`;
  await page.getByRole("button", { name: "使用邀请码注册", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("邀请码", { exact: true }).fill(invite);
  await page.getByRole("button", { name: "注册账户", exact: true }).click();
  await expect(page.getByRole("button", { name: "启用账户同步", exact: true })).toBeVisible();
  return username;
}
async function login(page: Page, username: string, pass = password) {
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "启用账户同步", exact: true })).toBeVisible();
}
async function importDataset(page: Page, count: number, padding = 0) {
  await navigate(page, "存档管理");
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "迁移 dataset.json", exact: true }).click();
  const data = syntheticDataset(count);
  if (padding) data.runs[0].raw.syntheticPadding = "x".repeat(padding);
  await (await picker).setFiles({ name: "dataset.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator(".metric-tile").filter({ hasText: "全部记录" }).locator("strong")).toHaveText(String(count));
}
async function enable(page: Page) {
  await navigate(page, "设置");
  await page.getByRole("button", { name: "启用账户同步", exact: true }).click();
  await expect(page.getByRole("button", { name: "同步账户数据", exact: true })).toBeEnabled();
}

test("two devices share data and favorites, preserve conflicts and keep anonymous data offline", async ({ page, browser }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "PUT") writes.push(request.url()); });
  await open(page);
  await importDataset(page, 1);
  await navigate(page, "设置");
  const username = await register(page);
  expect(writes).toEqual([]);
  await enable(page);
  await expect(page.getByText("已同步", { exact: true }).first()).toBeVisible();
  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:18766" });
  const other = await otherContext.newPage();
  await open(other); await login(other, username); await enable(other);
  await navigate(other, "存档管理");
  await expect(other.locator(".metric-tile").filter({ hasText: "全部记录" }).locator("strong")).toHaveText("1");
  await navigate(other, "单人记录");
  await other.getByRole("button", { name: "收藏记录", exact: true }).click();
  await navigate(other, "设置");
  await other.getByRole("button", { name: "同步账户数据", exact: true }).click();
  await expect(other.getByRole("button", { name: "同步账户数据", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "同步账户数据", exact: true }).click();
  await expect(page.getByRole("button", { name: "同步账户数据", exact: true })).toBeEnabled();
  await navigate(page, "单人记录");
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await navigate(page, "设置");
  await page.getByRole("button", { name: "暂停账户同步", exact: true }).click();
  await other.getByRole("button", { name: "暂停账户同步", exact: true }).click();
  await importDataset(page, 2); await importDataset(other, 3);
  await enable(page); await enable(other);
  await expect(other.getByText("杀戮尖塔 2同步冲突", { exact: true })).toBeVisible();
  await other.getByRole("button", { name: "备份本机并使用云端", exact: true }).click();
  await expect(other.getByRole("button", { name: "同步账户数据", exact: true })).toBeEnabled();
  await navigate(other, "存档管理");
  await expect(other.locator(".metric-tile").filter({ hasText: "全部记录" }).locator("strong")).toHaveText("2");
  await expect(other.getByText(/同步备份/).first()).toBeVisible();
  await other.reload();
  await other.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await navigate(other, "设置");
  await expect(other.getByText(username, { exact: true })).toBeVisible();
  await expect(other.getByRole("button", { name: "暂停账户同步", exact: true })).toBeVisible();
  await otherContext.close();
});

test("password rotation revokes another device and account deletion leaves local data readable", async ({ page, browser }) => {
  await open(page); await importDataset(page, 1); await navigate(page, "设置");
  const username = await register(page); await enable(page);
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:18766" });
  const other = await context.newPage(); await open(other); await login(other, username); await enable(other);
  await page.getByRole("button", { name: "管理账户", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  await page.getByLabel("新密码", { exact: true }).fill("updated-synthetic-password");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.getByText("密码已更新，其他设备需重新登录", { exact: true })).toBeVisible();
  await other.getByRole("button", { name: "同步账户数据", exact: true }).click();
  await expect(other.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await page.getByLabel("当前密码", { exact: true }).fill("updated-synthetic-password");
  await page.getByRole("button", { name: "删除账户", exact: true }).click();
  await page.getByRole("button", { name: "确认删除账户和云端数据", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await navigate(page, "存档管理");
  await expect(page.locator(".metric-tile").filter({ hasText: "全部记录" }).locator("strong")).toHaveText("1");
  await context.close();
});

test("large offline uploads retry safely and a changed browser account cannot receive the old account's data", async ({ page, context, browser }) => {
  await open(page); const username = await register(page);
  await importDataset(page, 1, 6 * 1024 * 1024);
  await navigate(page, "设置");
  await context.setOffline(true);
  await enable(page);
  await expect(page.getByText("同步未完成", { exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "同步账户数据", exact: true }).click();
  await expect(page.getByRole("button", { name: "同步账户数据", exact: true })).toBeEnabled();
  await expect(page.getByText("已同步", { exact: true }).first()).toBeVisible();
  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:18766" });
  const other = await otherContext.newPage(); await open(other); await login(other, username); await enable(other);
  await navigate(other, "存档管理");
  await expect(other.locator(".metric-tile").filter({ hasText: "全部记录" }).locator("strong")).toHaveText("1");
  const download = other.waitForEvent("download");
  await other.getByRole("button", { name: "导出数据", exact: true }).click();
  const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(exported.runs[0].raw.syntheticPadding.length).toBe(6 * 1024 * 1024);
  await otherContext.close();
  const db = openDatabase(".local-build/sync-e2e/sync.sqlite"); const invite = createInvite(db); db.close();
  const response = await context.request.post("/api/v1/auth/register", { data: { username: `synthetic-${randomUUID().slice(0, 12)}`, password, invite } });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "同步账户数据", exact: true }).click();
  await expect(page.getByText("当前登录账户已在其他窗口更改，请刷新后重新登录", { exact: true })).toBeVisible();
  expect((await (await context.request.get("/api/v1/vaults")).json()).vaults).toEqual([]);
});
