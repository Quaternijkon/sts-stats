import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { normalizeRun } from "../../Engine/domain/parser";

const runs = Array.from({ length: 125 }, (_, index) => normalizeRun({
  schema_version: 1, build_id: "synthetic-run-parity", game_mode: "standard", platform_type: "test",
  seed: `run-parity-seed-${index}`, start_time: 1700000000 + index * 86400,
  run_time: 600 + index, ascension: index % 3, win: true,
  players: [{ id: 1, character: "Ironclad", deck: [
    { id: "CARD.STRIKE_IRONCLAD", current_upgrade_level: 0 },
    { id: "CARD.STRIKE_IRONCLAD", current_upgrade_level: 0 },
    { id: "CARD.STRIKE_IRONCLAD", current_upgrade_level: 1 },
  ], relics: [], potions: [], badges: [] }],
  map_point_history: [[
    { map_point_type: "monster", rooms: [{ room_type: "monster", model_id: "synthetic encounter", turns_taken: 3 }],
      player_stats: [{ player_id: 1, current_hp: 50, max_hp: 60, current_gold: 20, damage_taken: 3, gold_gained: 20 }] },
    { map_point_type: "monster", rooms: [{ room_type: "monster", model_id: "synthetic encounter", turns_taken: 4 }],
      player_stats: [{ player_id: 1, current_hp: 30, max_hp: 60, current_gold: 25, damage_taken: 20, gold_gained: 5 }] },
    { map_point_type: "event", rooms: [{ room_type: "event", model_id: "synthetic event" }],
      player_stats: [{ player_id: 1, max_hp: 60, current_gold: 40, gold_gained: 15 }] },
  ]],
}, `run-parity-${index}.run`));
const coop = normalizeRun({
  schema_version: 1, build_id: "synthetic-run-parity", game_mode: "standard", platform_type: "test",
  seed: "synthetic-coop", start_time: 1800000000, run_time: 800, ascension: 1, win: false,
  players: [
    { id: 1, character: "Ironclad", deck: [{ id: "CARD.STRIKE_IRONCLAD", current_upgrade_level: 0 }], relics: [] },
    { id: 2, character: "Silent", deck: [], relics: [] },
  ],
  map_point_history: [[{ map_point_type: "monster", rooms: [{ room_type: "monster", model_id: "synthetic encounter" }],
    player_stats: [
      { player_id: 1, current_hp: 40, max_hp: 60, damage_taken: 8 },
      { player_id: 2, current_hp: 0, max_hp: 70, damage_taken: 15 },
    ] }]],
}, "synthetic-coop.run");
const dataset = { runs: [...runs, coop], progress: null, source: "/synthetic/run-parity", importedAt: 100, manifest: {}, fileRunIDs: {} };

async function ready(page: Page) {
  await expect(page.locator(".page-content [data-analysis-ready=true]").first()).toBeVisible();
  await expect(page.locator(".page-content .error-state")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ data, favorites }) => {
    localStorage.clear();
    localStorage.setItem("sts2stats.dataset.sts2", JSON.stringify(data));
    localStorage.setItem("sts2stats.preferences", JSON.stringify({
      theme: "light", minimumSample: 1, autoSync: false,
      games: { sts1: { source: "", favorites: [] }, sts2: { source: data.source, favorites, autoSync: false } },
    }));
  }, { data: dataset, favorites: runs.map((run) => run.id) });
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(page.locator(".metric-tile").filter({ hasText: "单人对局" }).locator("strong")).toHaveText("125");
});

test("returning from replay preserves second page, search, favorites and sorting", async ({ page }) => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "单人记录", exact: true }).click();
  await ready(page);
  const search = page.getByRole("searchbox", { name: "搜索记录", exact: true });
  await search.fill("run-parity");
  await ready(page);
  await page.getByLabel("仅收藏", { exact: true }).check();
  await ready(page);
  await page.locator("th").filter({ hasText: "日期" }).getByRole("button").click();
  await ready(page);
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("日期");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await ready(page);
  await expect(page.locator(".run-table tbody tr")).toHaveCount(25);
  await expect(page.locator(".pagination")).toContainText("2 / 2");
  await expect(page.locator(".run-table tbody tr").first()).toContainText("run-parity-100.run");
  await page.locator(".run-table tbody tr").first().getByRole("button").nth(1).click();
  await ready(page);
  await expect(page.getByRole("heading", { name: "记录复盘", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "已收藏", exact: true }).click();
  await expect(page.getByRole("button", { name: "收藏", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await ready(page);
  await expect(search).toHaveValue("run-parity");
  await expect(page.getByLabel("仅收藏", { exact: true })).toBeChecked();
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("日期");
  await expect(page.locator(".run-table tbody tr")).toHaveCount(24);
  await expect(page.locator(".pagination")).toContainText("2 / 2");
  await expect(page.locator(".run-table tbody tr").first()).toContainText("run-parity-101.run");
});

test("replay selects recorded nodes and exports the original save and chosen timeline", async ({ page }) => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "单人记录", exact: true }).click();
  await ready(page);
  await page.getByRole("searchbox", { name: "搜索记录", exact: true }).fill("run-parity-124.run");
  await ready(page);
  await expect(page.locator(".run-table tbody tr")).toHaveCount(1);
  await page.locator(".run-table tbody tr").getByRole("button").nth(1).click();
  await ready(page);
  const health = page.locator(".chart-grid .card").first();
  await expect(health.getByRole("heading", { name: "生命", exact: true })).toBeVisible();
  await expect(health.locator("circle")).toHaveCount(5);
  await health.locator('rect[role="button"]').nth(1).click();
  const details = page.locator(".card").filter({ has: page.getByRole("heading", { name: /^2 · / }) });
  await expect(details).toContainText("生命净减少 20");
  const hpLegend = health.locator(".timeline-legend").getByRole("button", { name: /^当前生命 / });
  await hpLegend.click();
  await expect(hpLegend).toHaveAttribute("aria-pressed", "true");
  await expect(health.locator("circle")).toHaveCount(2);
  await health.locator('rect[role="button"]').nth(1).focus();
  await health.locator('rect[role="button"]').nth(1).press("ArrowRight");
  await expect(page.getByRole("heading", { name: /^3 · / })).toBeVisible();
  await expect(page.locator(".metric-tile").filter({ hasText: "最终生命" }).locator("strong")).toHaveText("— / 60");
  await expect(page.getByRole("button", { name: "打击 ×2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "打击 +1 ×1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "原始 JSON", exact: true }).click();
  await expect(page.locator(".run-raw-json pre")).toContainText("run-parity-seed-124");

  const rawDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出原始存档", exact: true }).click();
  const raw = await rawDownload;
  expect(raw.suggestedFilename()).toBe("run-parity-124.run.json");
  expect(JSON.parse(await readFile((await raw.path())!, "utf8"))).toEqual(runs[124].raw);
  const normalizedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出记录", exact: true }).click();
  const normalized = await normalizedDownload;
  const record = JSON.parse(await readFile((await normalized.path())!, "utf8"));
  expect(record.id).toBe("run-parity-124.run");
  expect(record.replayPlayer).toBe(0);
  expect(record.timeline).toHaveLength(3);
  expect(record.raw).toEqual(runs[124].raw);
});

test("cooperative player switching keeps zero HP evidence and disables solo object analysis", async ({ page }) => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "多人记录", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("heading", { name: "队伍组合", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "玩家记录", exact: true })).toBeVisible();
  await page.locator(".run-table").first().locator("tbody tr").getByRole("button").nth(1).click();
  await ready(page);
  await expect(page.locator(".inventory button")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "同角色、同进阶基准", exact: true })).toHaveCount(0);
  await page.getByLabel("玩家视角", { exact: true }).selectOption("1");
  await ready(page);
  await expect(page.locator(".metric-tile").filter({ hasText: "最终生命" }).locator("strong")).toHaveText("0 / 70");
  await expect(page.locator(".metric-tile").filter({ hasText: "承伤" }).locator("strong")).toHaveText("15");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出记录", exact: true }).click();
  const record = JSON.parse(await readFile((await (await exported).path())!, "utf8"));
  expect(record.replayPlayer).toBe(1);
  expect(record.timeline[0].hp).toBe(0);
  expect(record.timeline[0].recordedFields).toContain("hp");
});
