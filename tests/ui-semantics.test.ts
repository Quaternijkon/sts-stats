import { describe, expect, it } from "vitest";
import { NumericColumnScale } from "../src/components/numericScales";
import {
  characterColor,
  characterAccentColor,
  metricSemantic,
  metricColor,
  numericColor,
  objectColor,
  preferenceColor,
  preferenceTextColor,
  rateColor,
} from "../src/styles/theme";

describe("complete-column numerical scales", () => {
  it("uses the first rank for ties and does not count missing values", () => {
    const scale = new NumericColumnScale([null, 10, 10, 20, 50, Number.NaN, undefined]);
    expect(scale.fraction(10)).toBe(0);
    expect(scale.fraction(20)).toBe(2 / 3);
    expect(scale.fraction(50)).toBe(1);
    expect(scale.fraction(null)).toBeNull();
    expect(scale.fraction(Number.NaN)).toBeNull();
    expect(scale.fraction(15)).toBeNull();
  });

  it("keeps the full-population ranks when displaying a later page", () => {
    const scale = new NumericColumnScale([1, 2, 4, 8]);
    expect([4, 8].map((value) => scale.fraction(value))).toEqual([2 / 3, 1]);
    expect(scale.intensity(4)).toBe(0.5);
  });

  it("treats a singleton and constant zero column as rank zero", () => {
    expect(new NumericColumnScale([42]).fraction(42)).toBe(0);
    const zeros = new NumericColumnScale([0, 0, 0]);
    expect(zeros.fraction(0)).toBe(0);
    expect(zeros.intensity(0)).toBe(0);
    expect(new NumericColumnScale([]).intensity(0)).toBeNull();
  });

  it("keeps magnitude independent of percentile, including negative columns", () => {
    const scale = new NumericColumnScale([-5, -5, 0, 5]);
    expect(scale.fraction(-5)).toBe(0);
    expect(scale.fraction(0)).toBe(2 / 3);
    expect(scale.intensity(0)).toBe(0.5);
  });
});

describe("shared color semantics", () => {
  it("uses fixed neutral and preference anchors", () => {
    expect(numericColor(0)).toBe("rgb(46 122 224)");
    expect(numericColor(0.5)).toBe("rgb(51 173 171)");
    expect(numericColor(1)).toBe("rgb(255 115 36)");
    expect(preferenceColor(0)).toBe("rgb(79 87 199)");
    expect(preferenceColor(1)).toBe("rgb(16 117 100)");
    expect(preferenceTextColor(0.5)).toBe("#000000");
    expect(preferenceTextColor(0)).toBe("#ffffff");
  });

  it("does not present non-finite values as a valid rate or preference", () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(numericColor(value)).toBe("var(--muted)");
      expect(rateColor(value)).toBe("var(--muted)");
      expect(preferenceColor(value)).toBe("var(--muted)");
      expect(preferenceTextColor(value)).toBe("var(--text)");
    }
    expect(rateColor(-1)).toBe(rateColor(0));
    expect(rateColor(2)).toBe(rateColor(1));
  });

  it("binds identity and object colors to IDs across spelling variants", () => {
    expect(characterColor("Ironclad")).toBe("var(--character-ironclad)");
    expect(characterColor("CHARACTER.IRONCLAD")).toBe(characterColor("Ironclad"));
    expect(characterAccentColor("The Silent")).toBe(characterAccentColor("Silent"));
    expect(characterColor("mod.One")).toBe(characterColor("mod.One"));
    expect(characterColor("Unknown")).toBe("var(--muted)");
    expect(objectColor("character", "Watcher")).toBe(characterColor("Watcher"));
    expect(objectColor("relic", "example")).toBe("var(--gold)");
    expect(objectColor("card", "example")).toBe("var(--choice)");
    expect(objectColor("outcome", "abandon")).toBe("var(--muted)");
  });

  it("separates rates, preference, and neutral percentages", () => {
    expect(metricSemantic("summary.winRate")).toBe("rate");
    expect(metricSemantic("heldWinRate")).toBe("rate");
    expect(metricSemantic("pickedWinCiLow")).toBe("rate");
    expect(metricSemantic("adjusted_pick_rate")).toBe("preference");
    expect(metricSemantic("pick_ci_high")).toBe("preference");
    expect(metricSemantic("share")).toBe("number");
    expect(metricSemantic("averageDamage")).toBe("number");
    expect(metricColor("bestWinStreak")).toBe("var(--streak)");
    expect(metricColor("averageHp")).toBe("var(--success)");
    expect(metricColor("totalPlayTime")).toBe("var(--time)");
  });
});
