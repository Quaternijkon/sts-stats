import { describe, expect, it } from "vitest";
import type { NormalizedRunV2, TimelinePoint } from "../Engine/domain/types";
import {
  curvePath, finalHealth, groupedCards, isCoopRun, rawExportName,
  recordedSegments, recordedTotal, recordedValue, withHealthChanges,
} from "../src/pages/runs/replay";

const point = (floor: number, values: Record<string, number>, fields = Object.keys(values)) => ({
  floor, act: 1, actFloor: floor, type: "monster", label: "synthetic",
  hp: 0, maxHp: 0, gold: 0, damageTaken: 0, hpHealed: 0, goldGained: 0, goldSpent: 0,
  ...values, recordedFields: fields,
}) as TimelinePoint;

describe("recorded replay evidence", () => {
  it("keeps an absent measurement distinct from a recorded zero", () => {
    expect(recordedValue(point(1, { damageTaken: 0 }), "damageTaken")).toBe(0);
    expect(recordedValue(point(1, { damageTaken: 0 }, []), "damageTaken")).toBeNull();
    expect(recordedTotal([point(1, {}, [])], "damageTaken")).toBeNull();
    expect(recordedTotal([point(1, { damageTaken: 0 })], "damageTaken")).toBe(0);
    expect(recordedTotal([point(1, { damageTaken: 8 }), point(2, {}, [])], "damageTaken")).toBe(8);
  });

  it("breaks health deltas and curves at missing values and missing floors", () => {
    const input = [point(1, { hp: 50 }), point(2, { hp: 30 }), point(3, {}, []),
      point(4, { hp: 45 }), point(6, { hp: 20 }), point(7, { hp: 25 })];
    const output = withHealthChanges(input);
    expect(recordedValue(output[1], "hpLoss")).toBe(20);
    expect(recordedValue(output[3], "hpGain")).toBeNull();
    expect(recordedValue(output[4], "hpLoss")).toBeNull();
    expect(recordedValue(output[5], "hpGain")).toBe(5);
    expect(recordedSegments(output, "hp")).toEqual([[0, 1], [3], [4, 5]]);
    expect(input[1].recordedFields).not.toContain("hpLoss");
  });

  it("groups inventory by stable card ID and upgrade level, keeping first-seen order", () => {
    expect(groupedCards([
      { id: "CARD.STRIKE_IRONCLAD", floorAdded: 0, upgradeLevel: 0 },
      { id: "CARD.STRIKE_IRONCLAD", floorAdded: 0, upgradeLevel: 1 },
      { id: "CARD.STRIKE_IRONCLAD", floorAdded: 1, upgradeLevel: 0 },
    ])).toEqual([
      { id: "CARD.STRIKE_IRONCLAD", upgrade: 0, count: 2 },
      { id: "CARD.STRIKE_IRONCLAD", upgrade: 1, count: 1 },
    ]);
  });

  it("uses the chosen player's final recorded health without borrowing another player", () => {
    const run = {
      players: [{ id: 10 }, { id: 20 }], raw: { players: [{ id: 10, current_hp: 80, max_hp: 80 }, { id: 20 }] },
      timeline: [point(2, { hp: 0, maxHp: 60 })], finalHp: 80, maxHp: 80,
    } as unknown as NormalizedRunV2;
    expect(finalHealth(run, 1)).toEqual({ hp: 0, maxHp: 60 });
    expect(finalHealth({ ...run, timeline: [point(2, {}, [])] }, 1)).toEqual({ hp: null, maxHp: null });
    expect(finalHealth({ ...run, timeline: [] }, 0)).toEqual({ hp: 80, maxHp: 80 });
  });

  it("treats every available multiplayer marker as sufficient to isolate analysis", () => {
    const solo = { isMultiplayer: false, playerCount: 1, players: [{}] } as NormalizedRunV2;
    expect(isCoopRun(solo)).toBe(false);
    expect(isCoopRun({ ...solo, isMultiplayer: true })).toBe(true);
    expect(isCoopRun({ ...solo, playerCount: 2 })).toBe(true);
    expect(isCoopRun({ ...solo, players: [{}, {}] } as NormalizedRunV2)).toBe(true);
  });

  it("passes through isolated and endpoint samples without inventing a predecessor", () => {
    expect(curvePath([{ x: 10, y: 20 }])).toBe("M10,20");
    expect(curvePath([{ x: 10, y: 20 }, { x: 40, y: 50 }])).toBe("M10,20 C20,30 30,40 40,50");
    expect(curvePath([])).toBe("");
  });

  it("exports original-save JSON without a writable game-save extension or paths", () => {
    expect(rawExportName("/synthetic/record.run")).toBe("record.run.json");
    expect(rawExportName("C:\\synthetic\\record.RUN")).toBe("record.RUN.json");
    expect(rawExportName("record.json")).toBe("record.json");
    expect(rawExportName("record")).toBe("record.json");
  });
});
