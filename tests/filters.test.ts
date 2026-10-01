import { describe, expect, it } from "vitest";
import { EMPTY_FILTER } from "../Engine/domain/schemas";
import { activeFilterTokens, dateRangePreset, parseObjectIDs, removeFilterPatch } from "../src/services/filters";

describe("page filter controls", () => {
  it("summarizes all selected values and keeps zero duration visible", () => {
    const tokens = activeFilterTokens({ ...structuredClone(EMPTY_FILTER), characters: ["Ironclad", "Silent"], ascensions: [0, 10], minDuration: 0 });
    expect(tokens.map((token) => token.key)).toEqual(["characters", "ascensions", "minDuration"]);
    expect(tokens[0].title).toContain("、");
    expect(tokens[1].title).toBe("进阶：A0、A10");
    expect(tokens[2].title).toBe("最短分钟：0");
  });
  it("clears only the chosen condition and its dependent threshold", () => {
    expect(removeFilterPatch("abandonPolicy")).toEqual({ abandonPolicy: "include", shortAbandonMinutes: 5 });
    expect(removeFilterPatch("characters")).toEqual({ characters: [] });
    expect(removeFilterPatch("dateFrom")).toEqual({ dateFrom: null });
    expect(activeFilterTokens(structuredClone(EMPTY_FILTER))).toEqual([]);
  });
  it("uses calendar days in the user's timezone across years", () => {
    expect(dateRangePreset(30, new Date(2026, 0, 15, 0, 5))).toEqual({ dateFrom: "2025-12-16", dateTo: null });
    expect(dateRangePreset(null)).toEqual({ dateFrom: null, dateTo: null });
  });
  it("preserves protected object IDs and deduplicates comma-separated entries", () => {
    expect(parseObjectIDs(" CARD.STRIKE_IRONCLAD, mod:Card，CARD.STRIKE_IRONCLAD\nRELIC.BURNING_BLOOD ")).toEqual(["CARD.STRIKE_IRONCLAD", "mod:Card", "RELIC.BURNING_BLOOD"]);
  });
});
