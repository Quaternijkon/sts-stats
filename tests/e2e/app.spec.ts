import { test, expect } from "@playwright/test";
import { normalizeRun } from "../../Engine/domain/parser";
const runs = Array.from({ length: 125 }, (_, i) =>
  normalizeRun(
    {
      win: i % 3 !== 0,
      ascension: i % 11,
      seed: `synthetic-${i}`,
      run_time: 900,
      start_time: 1700000000 + i * 86400,
      players: Array.from({ length: i === 0 ? 2 : 1 }, (_, j) => ({
        id: j + 1,
        character: i % 2 ? "CHARACTER.SILENT" : "CHARACTER.IRONCLAD",
        deck: [
          { id: "CARD.STRIKE_IRONCLAD", current_upgrade_level: 0 },
          { id: "CARD.STRIKE_IRONCLAD", current_upgrade_level: 0 },
          ...(i === 1
            ? [
                {
                  id: "CARD.SYNTHETIC_CARD_WITH_A_VERY_LONG_TITLE_FOR_LAYOUT_VERIFICATION",
                  current_upgrade_level: 0,
                },
              ]
            : []),
        ],
        relics: [],
      })),
      map_point_history: [
        [
          {
            map_point_type: "monster",
            player_stats: [
              {
                player_id: 1,
                current_hp: 70,
                max_hp: 80,
                current_gold: 99,
                damage_taken: 10,
              },
            ],
          },
        ],
      ],
    },
    `${i}.run`,
  ),
);
const dataset = {
  runs,
  progress: null,
  source: "/synthetic",
  importedAt: 100,
  manifest: {},
  fileRunIDs: {},
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.clear();
    localStorage.setItem("sts2stats.dataset.sts2", JSON.stringify(data));
  }, dataset);
});
test("statistics, objects, records, replay and game isolation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "全局统计", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".metric-tile")
      .filter({ hasText: "单人对局" })
      .locator("strong"),
  ).toHaveText("124");
  await expect(
    page.locator(".history-grid").first().locator("button"),
  ).toHaveCount(124);
  await page.getByRole("button", { name: "卡牌", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打击", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "打击", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "对象详情", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "单人记录", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(100);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(24);
  await page.locator("tbody tr").first().getByRole("button").nth(1).click();
  await expect(page.getByRole("heading", { name: "记录复盘" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打击 ×2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "尖塔数据终端", exact: true }).click();
  await page.getByRole("button", { name: "杀戮尖塔 1", exact: true }).click();
  await expect(page.getByText("尚未导入单人记录", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("theme, narrow layout and long scrolling tables", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(
    page.locator(".history-grid").first().locator("button"),
  ).toHaveCount(124);
  await page.screenshot({ path: testInfo.outputPath("overview-light.png") });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("外观").selectOption("dark");
  await page.getByRole("button", { name: "全局统计", exact: true }).click();
  await expect(
    page
      .locator(".metric-tile")
      .filter({ hasText: "单人对局" })
      .locator("strong"),
  ).toHaveText("124");
  await page.screenshot({ path: testInfo.outputPath("overview-dark.png") });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(page.getByRole("button", { name: "切换侧栏" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("overview-narrow.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "切换侧栏" }).click();
  await page.getByRole("button", { name: "单人记录", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(100);
  const scroll = page.locator(".table-scroll");
  await scroll.evaluate((el) => {
    el.scrollTop = 400;
    el.scrollLeft = 100;
  });
  const background = await page
    .locator("th")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("records-scrolled.png") });
});

test("all desktop navigation pages render without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  await expect(
    page
      .locator(".metric-tile")
      .filter({ hasText: "单人对局" })
      .locator("strong"),
  ).toHaveText("124");
  const labels = await page.locator(".sidebar nav button").allTextContents();
  for (const name of labels) {
    await page
      .locator(".sidebar nav")
      .getByRole("button", { name: name.trim(), exact: true })
      .click();
    await expect(page.locator(".page-content [data-analysis-ready='true']").first()).toBeAttached();
    await expect(page.locator(".page-content .error-state")).toHaveCount(0);
  }
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "卡牌", exact: true })
    .click();
  await page.getByRole("button", { name: "选择竞技场", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "导出 SVG", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".page-content")).not.toContainText("正在分析");
  await expect(page.locator(".page-content .error-state")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("perspective changes preserve chart structure and global filters", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "杀戮尖塔 2", exact: true }).click();
  const chart = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "楼层到达率", exact: true }),
  });
  const slider = chart.getByRole("slider");
  await slider.scrollIntoViewIfNeeded();
  await expect(chart.locator(".bar-column")).toHaveCount(50);
  const before = (await chart.boundingBox())!;
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(chart.locator(".chart-overlay")).toContainText("没有已完成对局");
  await expect(chart.locator(".rate-chart")).toHaveCount(1);
  await expect(chart.locator(".bar-column")).toHaveCount(50);
  const after = (await chart.boundingBox())!;
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  expect(Math.abs(before.height - after.height)).toBeLessThan(1);
  await expect(page.locator(".filters select").first()).toHaveValue("");
});
