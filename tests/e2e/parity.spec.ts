import { test, expect } from "@playwright/test";
import { normalizeRun } from "../../Engine/domain/parser";

const runs = Array.from({ length: 12 }, (_, index) => normalizeRun({
  schema_version: 1, build_id: "synthetic-parity", game_mode: "standard", platform_type: "test",
  seed: `synthetic-parity-${index}`, start_time: 1700000000 + index * 86400, run_time: 600 + index * 60,
  ascension: index % 3, win: index % 3 !== 0, was_abandoned: false,
  players: [{ id: 1, character: index % 2 ? "Silent" : "Ironclad", deck: [], relics: [], potions: [], badges: [] }],
  map_point_history: [[{ map_point_type: "monster", rooms: [{ room_type: "monster", model_id: "synthetic encounter", turns_taken: 3 }],
    player_stats: [{ player_id: 1, current_hp: 50, max_hp: 60, current_gold: 20, damage_taken: 3, hp_healed: 0, gold_gained: 20, gold_spent: 0 }] }]],
}, `synthetic-parity-${index}.run`));
const dataset = { runs, progress: null, source: "/synthetic/profile1/saves", importedAt: 100, manifest: {}, fileRunIDs: {} };

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    if (window.sessionStorage.getItem("synthetic-parity-initialized")) return;
    window.sessionStorage.setItem("synthetic-parity-initialized", "true");
    localStorage.clear();
    localStorage.setItem("sts2stats.dataset.sts2", JSON.stringify(data));
    localStorage.setItem("sts2stats.preferences", JSON.stringify({
      theme: "light", minimumSample: 1, autoSync: true,
      games: { sts1: { source: "", favorites: [], autoSync: true }, sts2: { source: "/synthetic/profile1/saves", favorites: [], autoSync: false } },
    }));
  }, dataset);
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(page.locator(".metric-tile").filter({ hasText: "单人对局" }).locator("strong")).toHaveText("12");
});

test("multi-value filters, removable tokens, date presets and independent page scopes", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "页面" });
  await page.getByRole("button", { name: "多选", exact: true }).click();
  const characters = page.getByRole("group", { name: "多选角色" });
  await characters.getByLabel("铁甲战士", { exact: true }).check();
  await characters.getByLabel("静默猎手", { exact: true }).check();
  await expect(page.locator(".filter-primary select").first()).toHaveValue("__multiple");
  await expect(page.locator(".filter-tokens")).toContainText("角色：铁甲战士、静默猎手");
  await navigation.getByRole("button", { name: "单人记录", exact: true }).click();
  await expect(page.locator(".filter-primary select").first()).toHaveValue("");
  await navigation.getByRole("button", { name: "全局统计", exact: true }).click();
  await expect(page.locator(".filter-primary select").first()).toHaveValue("__multiple");
  await page.getByRole("button", { name: "移除筛选：角色：铁甲战士、静默猎手", exact: true }).click();
  await expect(page.locator(".filter-primary select").first()).toHaveValue("");
  await page.locator(".date-presets summary").click();
  await page.getByRole("button", { name: "近 30 天", exact: true }).click();
  await expect(page.getByText("没有匹配的单人记录", { exact: true })).toBeVisible();
  await expect(page.locator(".filter-tokens")).toContainText("从：");
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page.locator(".metric-tile").filter({ hasText: "单人对局" }).locator("strong")).toHaveText("12");
  await page.locator(".filter-primary select").nth(1).selectOption("2");
  await expect(page.locator(".filter-tokens")).toContainText("进阶：A2");
  await page.reload();
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(page.locator(".filter-tokens")).toContainText("进阶：A2");
  await page.getByRole("button", { name: "移除筛选：进阶：A2", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(page.locator(".filter-tokens")).toHaveCount(0);
});

test("category hubs, navigation shortcuts and game-specific sync settings", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "页面" });
  await navigation.getByRole("button", { name: "游戏对象", exact: true }).click();
  await expect(page.locator(".category-tile")).toHaveCount(12);
  await page.locator(".category-grid").getByRole("button", { name: "特效", exact: true }).click();
  await expect(page.locator(".toolbar h1")).toHaveText("特效");
  await page.keyboard.press("Control+2");
  await expect(page.locator(".toolbar h1")).toHaveText("卡牌");
  await page.keyboard.press("Control+3");
  await expect(page.locator(".toolbar h1")).toHaveText("单人记录");
  await navigation.getByRole("button", { name: "存档管理", exact: true }).click();
  await expect(page.locator(".metric-tile").filter({ hasText: "单人记录" }).locator("strong")).toHaveText("12");
  await expect(page.getByRole("button", { name: "打开数据文件夹", exact: true })).toBeVisible();
  await expect(page.getByLabel("自动同步", { exact: true })).not.toBeChecked();
  await page.keyboard.press("Control+,");
  await expect(page.locator(".toolbar h1")).toHaveText("设置");
  await expect(page.getByLabel("最低样本量", { exact: true })).toHaveAttribute("max", "1000");
  await page.keyboard.press("Control+0");
  await page.getByRole("button", { name: "杀戮尖塔 1", exact: true }).click();
  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("自动同步", { exact: true })).toBeChecked();
  await expect(page.getByLabel("自动同步", { exact: true })).toBeDisabled();
});

test("calendar years, career expansion and narrow sidebar dismissal", async ({ page }) => {
  await page.getByLabel("游戏投入时间年份", { exact: true }).selectOption("2023");
  await expect(page.getByRole("group", { name: "2023 年游戏投入时间" })).toBeVisible();
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "生涯统计", exact: true }).click();
  const records = page.locator(".card").filter({ has: page.getByRole("heading", { name: "角色记录", exact: true }) });
  await records.getByRole("button", { name: "铁甲战士", exact: true }).click();
  await expect(records.getByText("铁甲战士 · 完整角色记录", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 640, height: 900 });
  const toggle = page.getByRole("button", { name: "切换侧栏", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
