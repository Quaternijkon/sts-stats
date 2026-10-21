import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeRun } from "../../Engine/domain/parser";

const raw = (start: number) => ({ win: true, start_time: start, seed: `synthetic-web-${start}`, run_time: 600,
  players: [{ id: 1, character: "Ironclad", deck: [], relics: [] }], map_point_history: [] });
const dataset = (count = 1) => ({ source: "/synthetic/web", importedAt: 12345, progress: null, manifest: {}, fileRunIDs: {},
  runs: Array.from({ length: count }, (_, index) => normalizeRun(raw(100 + index), `synthetic-${index}.run`)) });

async function prepare(page: Page, directory = false) {
  await page.addInitScript(({ directory }) => {
    const target = window as any;
    if (location.port === "1421") target.__TAURI_INTERNALS__ = { invoke() { throw new Error("Web build attempted native IPC"); } };
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: directory ? async (options: unknown) => {
      target.__pickerOptions = options;
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("synthetic-saves", { create: true });
      const file = await root.getFileHandle("one.run", { create: true });
      const writer = await file.createWritable();
      await writer.write(JSON.stringify({ win: true, start_time: 100, seed: "synthetic-first", run_time: 600,
        players: [{ id: 1, character: "Ironclad", deck: [], relics: [] }], map_point_history: [] }));
      await writer.close();
      target.__originalTime = (await file.getFile()).lastModified;
      return root;
    } : undefined });
  }, { directory });
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "存档管理", exact: true }).click();
  await expect(page.locator('.page-content [data-analysis-ready="true"]').first()).toBeAttached();
}
function count(page: Page) { return page.locator(".metric-tile").filter({ hasText: "全部记录" }).locator("strong"); }
async function importJSON(page: Page, text: string) {
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "迁移 dataset.json", exact: true }).click();
  await (await picker).setFiles({ name: "dataset.json", mimeType: "application/json", buffer: Buffer.from(text) });
}
async function reopen(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "存档管理", exact: true }).click();
}

test("manual save import survives reload and export; a corrupt import leaves it intact", async ({ page }) => {
  await prepare(page);
  if (new URL(page.url()).port === "1421") await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /connect-src 'self'/);
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入文件", exact: true }).click();
  await (await picker).setFiles({ name: "synthetic.run", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(raw(100))) });
  await expect(count(page)).toHaveText("1");
  await reopen(page);
  await expect(count(page)).toHaveText("1");
  await expect(page.getByLabel("自动同步", { exact: true })).toBeDisabled();
  await importJSON(page, "corrupt JSON");
  await expect(page.locator(".global-error")).toBeVisible();
  await expect(count(page)).toHaveText("1");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  const data = JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
  expect(data.runs).toHaveLength(1);
  expect(data.runs[0].raw.seed).toBe("synthetic-web-100");
  const nav = page.getByRole("navigation", { name: "页面" });
  await page.getByRole("button", { name: "尖塔数据终端", exact: true }).click();
  await page.getByRole("button", { name: "杀戮尖塔 1", exact: true }).click();
  await nav.getByRole("button", { name: "存档管理", exact: true }).click();
  await expect(count(page)).toHaveText("0");
});

test("large datasets, favorites and preferences persist beyond the localStorage limit", async ({ page }) => {
  await prepare(page);
  const data = dataset(); data.runs[0].raw.syntheticPadding = "x".repeat(6 * 1024 * 1024);
  await importJSON(page, JSON.stringify(data));
  await expect(count(page)).toHaveText("1");
  const nav = page.getByRole("navigation", { name: "页面" });
  await nav.getByRole("button", { name: "单人记录", exact: true }).click();
  await page.getByRole("button", { name: "收藏记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("combobox", { name: "外观", exact: true }).selectOption("dark");
  await page.getByLabel("最低样本量", { exact: true }).fill("7");
  await reopen(page);
  await expect(count(page)).toHaveText("1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await nav.getByRole("button", { name: "单人记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("最低样本量", { exact: true })).toHaveValue("7");
  expect(await page.evaluate(() => localStorage.getItem("sts2stats.dataset.sts2"))).toBeNull();
});

test("folder fallback selects one Profile and never modifies selected files", async ({ page }, info) => {
  const root = info.outputPath("synthetic-account");
  await mkdir(`${root}/profile1/saves`, { recursive: true });
  await mkdir(`${root}/profile2/saves`, { recursive: true });
  await writeFile(`${root}/profile.save`, '{"last_profile_id":2}');
  await writeFile(`${root}/profile1/saves/old.run`, JSON.stringify(raw(100)));
  const original = JSON.stringify(raw(200));
  await writeFile(`${root}/profile2/saves/current.run`, original);
  await prepare(page);
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入文件夹", exact: true }).last().click();
  await (await picker).setFiles(root);
  await expect(count(page)).toHaveText("1");
  await expect(page.locator(".details").first()).toContainText("synthetic-account/profile2/saves");
  expect(await readFile(`${root}/profile2/saves/current.run`, "utf8")).toBe(original);
  await expect(page.getByLabel("自动同步", { exact: true })).toBeDisabled();
});

test("browser storage hides native-only actions and serves game assets without IPC", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await prepare(page);
  await expect(page.getByRole("heading", { name: "原应用迁移", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开数据文件夹", exact: true })).toHaveCount(0);
  await expect(page.getByText("当前站点的浏览器存储", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "尖塔数据终端", exact: true }).click();
  expect(await page.locator(".game-card img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(errors).toEqual([]);
});

test("another tab follows committed data without requiring a page reload", async ({ page, context }) => {
  await prepare(page);
  await importJSON(page, JSON.stringify(dataset()));
  await expect(count(page)).toHaveText("1");
  const other = await context.newPage();
  await prepare(other);
  await expect(count(other)).toHaveText("1");
  const nav = page.getByRole("navigation", { name: "页面" });
  const otherNav = other.getByRole("navigation", { name: "页面" });
  await nav.getByRole("button", { name: "单人记录", exact: true }).click();
  await page.getByRole("button", { name: "收藏记录", exact: true }).click();
  await otherNav.getByRole("button", { name: "单人记录", exact: true }).click();
  await expect(other.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "存档管理", exact: true }).click();
  await otherNav.getByRole("button", { name: "存档管理", exact: true }).click();
  await importJSON(page, JSON.stringify(dataset(2)));
  await expect(count(page)).toHaveText("2");
  await expect(count(other)).toHaveText("2");
  await other.close();
});

test("read-only directory authorization supports sync and permission renewal", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "目录授权 API 不在 WebKit 中提供，WebKit 验证手动目录导入");
  await prepare(page, true);
  await page.getByRole("button", { name: "导入文件夹", exact: true }).last().click();
  await expect(count(page)).toHaveText("1");
  expect(await page.evaluate(() => (window as any).__pickerOptions.mode)).toBe("read");
  expect(await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("synthetic-saves");
    return (await (await root.getFileHandle("one.run")).getFile()).lastModified === (window as any).__originalTime;
  })).toBe(true);
  await expect(page.getByLabel("自动同步", { exact: true })).toBeChecked();
  await page.evaluate(async (value) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("synthetic-saves");
    const writer = await (await root.getFileHandle("two.run", { create: true })).createWritable();
    await writer.write(JSON.stringify(value)); await writer.close();
  }, raw(200));
  await expect(count(page)).toHaveText("2", { timeout: 15000 });
  await page.evaluate(() => {
    const target = window as any;
    target.__permission = "prompt";
    Object.defineProperty(FileSystemDirectoryHandle.prototype, "queryPermission", { configurable: true, value: async () => target.__permission });
    Object.defineProperty(FileSystemDirectoryHandle.prototype, "requestPermission", { configurable: true, value: async (options: unknown) => {
      target.__permissionOptions = options; target.__permission = "granted"; return "granted";
    } });
  });
  await page.getByRole("button", { name: "立即同步", exact: true }).last().click();
  await expect(page.locator(".sync-state .error-state")).toContainText("读取权限已失效");
  await page.getByRole("button", { name: "重新授权目录", exact: true }).click();
  await expect(page.locator(".sync-state .error-state")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__permissionOptions.mode)).toBe("read");
  await page.getByLabel("自动同步", { exact: true }).uncheck();
  await reopen(page);
  await expect(count(page)).toHaveText("2");
  await expect(page.getByLabel("自动同步", { exact: true })).not.toBeChecked();
});
