import { describe, expect, it } from "vitest";
import {
  activityDays,
  activityWeeks,
  activityYears,
  floorRates,
  outcomeLayout,
  signedRestValue,
  type RunSummary,
} from "../src/pages/overview/helpers";
import { NumericColumnScale } from "../src/components/numericScales";

const summary = (patch: Partial<RunSummary> = {}): RunSummary => ({
  total: 4, completed: 4, wins: 3, losses: 1, abandoned: 0, winRate: 0.75,
  avgFloor: 40, avgTime: 600, avgDeck: 20, highestAscension: 10,
  currentStreak: 1, maxWinStreak: 3, avgDamageTaken: 50,
  minWinningDeckSize: 10, maxWinningDeckSize: 30, ...patch,
});

describe("overview calendar ranges", () => {
  it("keeps the leap day in a recent calendar year and truncates a selected year at today", () => {
    const recent = activityDays(new Date(2024, 1, 29, 15));
    expect(recent).toHaveLength(366);
    expect(recent[0].date).toBe("2023-03-01");
    expect(recent.at(-1)?.date).toBe("2024-02-29");
    expect(activityDays(new Date(2024, 1, 29), 2024)).toHaveLength(60);
    expect(activityDays(new Date(2025, 0, 1), 2024)).toHaveLength(366);
    expect(activityDays(new Date(2024, 1, 29), 2025)).toEqual([]);
  });
  it("aligns partial weeks with Sunday first and keeps previously selected years", () => {
    const days = activityDays(new Date(2024, 0, 3), 2024);
    const weeks = activityWeeks(days);
    expect(weeks[0].map((day) => day?.date ?? null)).toEqual([
      null, "2024-01-01", "2024-01-02", "2024-01-03", null, null, null,
    ]);
    expect(activityYears(new Date(2023, 8, 1).valueOf() / 1000, new Date(2025, 0, 1), 2022)).toEqual([2025, 2024, 2023, 2022]);
  });
  it("uses actual local midnight boundaries on a daylight-saving transition", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const days = activityDays(new Date(2024, 2, 11), 2024);
      const transition = days.find((day) => day.date === "2024-03-10")!;
      expect(transition.endTime - transition.startTime).toBe(23 * 3600);
      expect(days.every((day, index) => index === 0 || day.startTime === days[index - 1].endTime)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("overview chart and table semantics", () => {
  it("places the latest outcome in the bottom-right slot without losing overflow history", () => {
    const single = outcomeLayout(280, 1);
    expect(single.padding + 1).toBe(single.columns * 5);
    const overflow = outcomeLayout(280, 124);
    expect(overflow.columns).toBe(25);
    expect(overflow.padding).toBe(1);
    expect(overflow.cellSize).toBe(single.cellSize);
  });
  it("derives completion from non-abandoned outcomes and ignores actual floor 50", () => {
    const rates = floorRates({ summary: summary(), survival: [{ floor: 1, value: 1 }, { floor: 49, value: 0.25 }, { floor: 50, value: 0.01 }, { floor: 70, value: 0.01 }] });
    expect(rates).toHaveLength(50);
    expect(rates[48]).toEqual({ label: "49", value: 0.25 });
    expect(rates[49]).toEqual({ label: "50 · 通关", value: 0.75 });
    expect(rates[1].value).toBeNull();
    expect(floorRates({ summary: summary({ completed: 0, wins: 0 }) })).toEqual([]);
  });
  it("ranks complete columns with shared tied ranks and leaves missing samples out", () => {
    const scale = new NumericColumnScale([null, 10, 10, 20, 40]);
    expect([null, 10, 10, 20, 40].map((value) => scale.fraction(value))).toEqual([null, 0, 0, 2 / 3, 1]);
    expect(new NumericColumnScale([4]).fraction(4)).toBe(0);
    expect(new NumericColumnScale([8, 8]).fraction(8)).toBe(0);
    const uneven = new NumericColumnScale([1, 2, 100]);
    expect(uneven.fraction(2)).toBe(0.5);
    expect(uneven.intensity(2)).toBe(0.02);
  });
  it("reports signed route differences in percentage points and preserves missing correlations", () => {
    expect(signedRestValue(0.1234, 1, 100)).toBe("+12.3");
    expect(signedRestValue(-0.25, 1, 100)).toBe("-25.0");
    expect(signedRestValue(0.25, 3)).toBe("+0.250");
    expect(signedRestValue(null, 3)).toBe("—");
  });
});
