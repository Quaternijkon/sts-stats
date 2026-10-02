import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { normalizeRun } from "../../Engine/domain/parser";

const strike = "CARD.STRIKE_IRONCLAD";
const cards = Array.from({ length: 45 }, (_, index) => `CARD.SYNTHETIC_${index}`);
const runs = Array.from({ length: 125 }, (_, index) => normalizeRun({
  win: index % 3 !== 0,
  ascension: index % 5,
  seed: `object-parity-${index}`,
  run_time: 900,
  start_time: 1700000000 + index * 86400,
  players: [{ id: 1, character: "CHARACTER.IRONCLAD", deck: [
    { id: strike, current_upgrade_level: 0 },
    { id: strike, current_upgrade_level: 1 },
  ], relics: [] }],
  map_point_history: [[{
    map_point_type: "monster",
    player_stats: [{
      player_id: 1,
      current_hp: 70,
      max_hp: 80,
      current_gold: 99,
      damage_taken: 10,
      card_choices: [
        { card: { id: strike }, was_picked: index % 3 === 0 },
        { card: { id: cards[index % cards.length] }, was_picked: index % 3 !== 0 },
        { card: { id: cards[(index + 1) % cards.length] }, was_picked: false },
      ],
    }],
  }]],
}, `object-parity-${index}.run`));
const dataset = { runs, progress: null, source: "/synthetic-object-parity", importedAt: 100, manifest: {}, fileRunIDs: {} };

async function ready(page: Page) {
  await expect(page.locator('.page-content [data-analysis-ready="true"]').first()).toBeVisible();
  await expect(page.locator('.page-content [aria-busy="true"]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.clear();
    localStorage.setItem("sts2stats.dataset.sts2", JSON.stringify(data));
  }, dataset);
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
});

test("object navigation preserves queries and evidence beyond the former cap", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "卡牌", exact: true }).click();
  await ready(page);
  await page.getByRole("searchbox", { name: "搜索对象" }).fill(strike);
  await ready(page);
  await page.getByRole("button", { name: "打击", exact: true }).first().click();
  await ready(page);
  await expect(page.getByRole("button", { name: "导出完整详情" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 PNG" })).toBeVisible();
  const evidence = page.locator(".card").filter({ has: page.getByRole("heading", { name: "统计证据", exact: true }) });
  const firstIds = await evidence.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-evidence-id")));
  await expect(evidence.locator("tbody tr")).toHaveCount(100);
  await evidence.getByRole("button", { name: "下一页", exact: true }).click();
  await ready(page);
  await evidence.getByRole("button", { name: "下一页", exact: true }).click();
  await ready(page);
  await expect(evidence.locator(".pagination")).toContainText("201–300");
  const thirdIds = await evidence.locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-evidence-id")));
  expect(thirdIds.every((id) => id && !firstIds.includes(id))).toBe(true);
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("searchbox", { name: "搜索对象" })).toHaveValue(strike);
  await expect(page.locator(".page-content tbody tr")).toHaveCount(1);
});

test("arena pages independently, exports the same matrix to PNG and keeps sticky headers", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "卡牌", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "选择竞技场", exact: true }).click();
  await ready(page);
  const matrix = page.locator(".card").filter({ has: page.getByRole("heading", { name: "选择偏好", exact: true }) });
  const ranks = page.locator(".card").filter({ has: page.getByRole("heading", { name: "排名", exact: true }) });
  await expect(ranks.locator("tbody tr")).toHaveCount(46);
  await matrix.getByRole("button", { name: "下一页", exact: true }).first().click();
  await expect(matrix.locator("tbody tr")).toHaveCount(6);
  await expect(ranks.locator("tbody tr")).toHaveCount(46);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
  const image = await download;
  expect(image.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile((await image.path())!);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  expect(Math.max(width, height)).toBeLessThanOrEqual(8192);
  expect(width * height).toBeLessThanOrEqual(16_777_216);
  const header = matrix.locator("thead .sticky-name");
  expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
  expect(await header.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("arena-light.png") });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("外观").selectOption("dark");
  await page.getByRole("button", { name: "卡牌", exact: true }).click();
  await ready(page);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("arena-dark-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("archetype run pagination leaves the card attribution table intact", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "卡牌流派", exact: true }).click();
  await ready(page);
  const attribution = page.locator(".card").filter({ has: page.getByRole("heading", { name: "卡牌归属", exact: true }) });
  const composition = page.locator(".card").filter({ has: page.getByRole("heading", { name: "对局构成", exact: true }) });
  await expect(attribution.locator("tbody tr")).toHaveCount(cards.length + 1);
  const count = await attribution.locator("tbody tr").count();
  expect(count).toBeGreaterThan(0);
  await expect(attribution.locator('tr[data-card-id="CARD.SYNTHETIC_0"]')).toHaveAttribute("data-evidence-status", "insufficient");
  await expect(attribution.locator('tr[data-card-id="CARD.SYNTHETIC_0"] .numeric-cell.missing')).toHaveCount(8);
  await expect(attribution.locator(`tr[data-card-id="${strike}"]`)).toHaveAttribute("data-evidence-status", "starter");
  await expect(attribution.getByRole("button", { name: "导出 CSV", exact: true })).toBeEnabled();
  await attribution.getByRole("combobox", { name: "证据", exact: true }).selectOption("insufficient");
  await expect(attribution.locator("tbody tr")).toHaveCount(cards.length);
  await attribution.getByRole("combobox", { name: "证据", exact: true }).selectOption("starter");
  await expect(attribution.locator("tbody tr")).toHaveCount(1);
  await attribution.getByRole("combobox", { name: "证据", exact: true }).selectOption("all");
  await expect(attribution.locator("tbody tr")).toHaveCount(count);
  await expect(composition.locator("tbody tr")).toHaveCount(100);
  await composition.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(composition.locator("tbody tr")).toHaveCount(25);
  await expect(attribution.locator("tbody tr")).toHaveCount(count);
});
