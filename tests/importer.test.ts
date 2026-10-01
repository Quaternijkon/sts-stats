import { describe, it, expect } from "vitest";
import {
  emptyDataset,
  prepareImport,
  validateDataset,
  FOUNDATION_EPOCH,
} from "../src/services/dataset";
import type { SaveFile } from "../src/services/models";
const raw = (start = 100, win = true) =>
  JSON.stringify({
    win,
    start_time: start,
    seed: "test-seed",
    run_time: 600,
    players: [{ id: 1, character: "CHARACTER.IRONCLAD", deck: [], relics: [] }],
    map_point_history: [],
  });
const file = (
  text = raw(),
  path = "/synthetic/a.run",
  modifiedAt = 1,
): SaveFile => ({ name: path.split("/").at(-1)!, path, text, modifiedAt });
describe("local import transactions", () => {
  it("preserves removed history and deduplicates renamed copies", async () => {
    const initial = await prepareImport(
      emptyDataset(),
      [file()],
      "/synthetic",
      "sts2",
    );
    const renamed = await prepareImport(
      initial,
      [file(raw(), "/synthetic/renamed.run", 2)],
      "/synthetic",
      "sts2",
    );
    expect(renamed.runs).toHaveLength(1);
    const withNew = await prepareImport(
      renamed,
      [file(raw(200), "/synthetic/new.run", 3)],
      "/synthetic",
      "sts2",
    );
    expect(withNew.runs).toHaveLength(2);
    expect(withNew.runs.map((r) => r.id)).toContain("a.run");
  });
  it("keeps different games with the same filename", async () => {
    const imported = await prepareImport(
      emptyDataset(),
      [file(), file(raw(200), "/synthetic/other/a.run", 2)],
      "/synthetic",
      "sts2",
    );
    expect(imported.runs).toHaveLength(2);
    expect(new Set(imported.runs.map((r) => r.id)).size).toBe(2);
  });
  it("selects the newest revision and rejects ambiguous timestamps", async () => {
    const base = await prepareImport(
      emptyDataset(),
      [file(raw(100, false))],
      "/synthetic",
      "sts2",
    );
    const newer = await prepareImport(
      base,
      [
        file(raw(100, true), "/synthetic/a.run", 3),
        file(raw(100, false), "/synthetic/old.run", 2),
      ],
      "/synthetic",
      "sts2",
    );
    expect(newer.runs[0].win).toBe(true);
    await expect(
      prepareImport(
        base,
        [file(raw(100, true), "/synthetic/a.run", 1)],
        "/synthetic",
        "sts2",
      ),
    ).rejects.toThrow("时间相同");
    expect(base.runs[0].win).toBe(false);
  });
  it("rejects the whole transaction when one file is corrupt", async () => {
    const base = await prepareImport(
      emptyDataset(),
      [file()],
      "/synthetic",
      "sts2",
    );
    const before = JSON.stringify(base);
    await expect(
      prepareImport(
        base,
        [
          file(raw(200), "/synthetic/new.run"),
          file("bad json", "/synthetic/bad.run"),
        ],
        "/synthetic",
        "sts2",
      ),
    ).rejects.toThrow("未提交");
    expect(JSON.stringify(base)).toBe(before);
  });
  it("isolates sources and rejects multiple profiles", async () => {
    const base = await prepareImport(
      emptyDataset(),
      [file()],
      "/synthetic",
      "sts2",
    );
    const other = await prepareImport(
      base,
      [file(raw(200), "/other/new.run")],
      "/other",
      "sts2",
    );
    expect(other.runs).toHaveLength(1);
    await expect(
      prepareImport(
        base,
        [file("{}", "/a/progress.save"), file("{}", "/b/progress.save")],
        "/",
        "sts2",
      ),
    ).rejects.toThrow("单一");
  });
  it("rejects cross-game imports", async () => {
    await expect(
      prepareImport(emptyDataset(), [file()], "/synthetic", "sts1"),
    ).rejects.toThrow("二代存档");
    const base = await prepareImport(
      emptyDataset(),
      [file()],
      "/synthetic",
      "sts2",
    );
    expect(() => validateDataset(base, "sts1")).toThrow("另一个游戏");
  });
  it("preserves Foundation dates and validates native dataset shape", async () => {
    const base = await prepareImport(
      emptyDataset(),
      [file()],
      "/synthetic",
      "sts2",
    );
    const old = { ...base, importedAt: 12345 };
    expect(validateDataset(JSON.parse(JSON.stringify(old))).importedAt).toBe(
      12345,
    );
    expect(
      Math.abs(base.importedAt + FOUNDATION_EPOCH - Date.now() / 1000),
    ).toBeLessThan(2);
    expect(() =>
      validateDataset({ ...base, runs: [...base.runs, ...base.runs] }),
    ).toThrow("重复");
  });
});
