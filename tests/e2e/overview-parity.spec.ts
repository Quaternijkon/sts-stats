import { expect, test } from "@playwright/test";
import { normalizeRun } from "../../Engine/domain/parser";
import { zhCharacter, zhFromTable } from "../../Engine/domain/i18n";

const year = new Date().getFullYear() - 1;
const node = (type: string, hp: number, choices: string[] = []) => ({
  map_point_type: type,
  player_stats: [{ player_id: 1, current_hp: hp, max_hp: 100, rest_site_choices: choices }],
});
const makeRun = (id: string, character: string, ascension: number, day: number) => normalizeRun({
  win: true,
  ascension,
  seed: `overview-synthetic-${id}`,
  start_time: new Date(year, 0, day, 12).valueOf() / 1000,
  run_time: 600,
  players: [{ id: 1, character: `CHARACTER.${character.toUpperCase()}`, deck: [], relics: [] }],
  map_point_history: [[node("monster", 10), node("rest_site", 70, ["HEAL", "HEAL"]), node("shop", 80), node("rest_site", 80, ["SMITH"]), node("monster", 90), node("rest_site", 90, ["SMITH"])]],
}, id);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((runs) => {
    localStorage.clear();
    localStorage.setItem("sts2stats.dataset.sts2", JSON.stringify({ runs, progress: null, source: "/synthetic-overview", importedAt: 100, manifest: {}, fileRunIDs: {} }));
  }, [makeRun("overview-a.run", "Ironclad", 12, 1), makeRun("overview-b.run", "Silent", 7, 2)]);
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(page.locator(".metric-tile").filter({ hasText: "单人对局" }).locator("strong")).toHaveText("2");
});

test("calendar years expose local dates and outcome grids start at the latest record", async ({ page }) => {
  await page.getByLabel("游戏投入时间年份").selectOption(String(year));
  const days = page.locator(".overview-calendar-day:not(.empty)");
  await expect(days.first()).toHaveAttribute("title", new RegExp(`^${year}-01-01`));
  await expect(days.last()).toHaveAttribute("title", new RegExp(`^${year}-12-31`));
  const expectedDays = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  await expect(days).toHaveCount(expectedDays);
  await expect(page.locator(".overview-weekdays")).toContainText("周一");
  const latest = page.locator(".history-grid").first().locator("button").last();
  await latest.scrollIntoViewIfNeeded();
  await expect(latest).toBeInViewport();
  await latest.click();
  await expect(page.getByRole("heading", { name: "记录复盘", exact: true })).toBeVisible();
});

test("career exposes sortable ascension and complete character statistics", async ({ page }) => {
  await page.getByRole("button", { name: "生涯统计", exact: true }).click();
  const records = page.locator(".card").filter({ has: page.getByRole("heading", { name: "角色记录", exact: true }) });
  await records.getByRole("button", { name: "最高进阶", exact: true }).click();
  const first = records.locator("tbody tr").first();
  await expect(first).toContainText(zhCharacter("Ironclad"));
  await expect(first.locator("td").nth(6)).toHaveText("12");
  await first.getByRole("button", { name: zhCharacter("Ironclad"), exact: true }).click();
  await expect(records.locator(".overview-character-record")).toContainText("当前连胜");
  await expect(records.locator(".overview-character-record")).toContainText("平均承伤");
});

test("rest analysis distinguishes executions, samples and signed percentage-point differences", async ({ page }) => {
  await page.getByRole("button", { name: "休息处分析", exact: true }).click();
  const choiceTable = page.locator(".card").filter({ has: page.getByRole("heading", { name: "选择统计", exact: true }) });
  const heal = zhFromTable("rest_site_ui", "OPTION_HEAL.name", "HEAL");
  const row = choiceTable.locator("tbody tr").filter({ hasText: heal });
  await expect(row.locator("td")).toHaveCount(10);
  await expect(row.locator("td").nth(6)).toHaveText("2");
  await expect(row.locator("td").nth(9)).toHaveText("4");
  const routes = page.locator(".card").filter({ has: page.getByRole("heading", { name: "后续路线", exact: true }) });
  const shop = zhFromTable("map", "LEGEND_MERCHANT.hoverTip.title", "shop");
  const shopHeal = routes.locator("tbody tr").filter({ hasText: shop }).filter({ hasText: heal });
  await expect(shopHeal.locator("td").nth(4)).toHaveText("+100.0");
  await expect(shopHeal.locator("td").nth(5)).toHaveText("+1.000");
  await expect(shopHeal.locator("td").nth(7)).toHaveText("2");
  await expect(shopHeal.locator("td").nth(9)).toHaveText("0");
  await expect(page.locator(".metric-tile").filter({ hasText: "截尾／不完整" }).locator("strong")).toHaveText("2 / 0");
});
