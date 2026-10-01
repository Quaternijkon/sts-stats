import { describe, it, expect } from "vitest";
import {
  emptyDataset,
  prepareImport,
  validateDataset,
  prepareImportTransaction,
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
  it("restores archived history after all original files have been removed", async () => {
    const archived = await prepareImport(emptyDataset(), [file()], "/synthetic", "sts2");
    const restored = await prepareImport(archived, [], "/synthetic", "sts2");
    expect(restored.runs).toEqual(archived.runs);
    await expect(prepareImport(emptyDataset(), [], "/empty", "sts2")).rejects.toThrow("没有");
  });
  it("keeps original import identity when the same game is completed", async () => {
    const initial = await prepareImport(emptyDataset(), [file(raw(100, false))], "/synthetic", "sts2");
    initial.runs[0].importedAt = 1234;
    const completed = await prepareImport(initial, [file(raw(100, true), "/synthetic/a.run", 2)], "/synthetic", "sts2");
    expect(completed.runs[0]).toMatchObject({ importedAt: 1234, sourceKey: initial.runs[0].id, win: true });
  });
  it("does not let a newer timestamp on an archived old copy block a new revision", async () => {
    const initial = await prepareImport(emptyDataset(), [file(raw(100, false))], "/synthetic", "sts2");
    const completed = await prepareImport(initial, [file(raw(100, true), "/synthetic/a.run", 3)], "/synthetic", "sts2");
    const copy = await prepareImport(completed, [file(raw(100, false), "/synthetic/copy.run", 100)], "/synthetic", "sts2");
    expect(Object.values(copy.importMetadata!)[0].modifiedAt).toBe(3);
    const revision = JSON.stringify({ ...JSON.parse(raw(100, true)), run_time: 999 });
    const newest = await prepareImport(copy, [file(revision, "/synthetic/a.run", 4)], "/synthetic", "sts2");
    expect(newest.runs[0].runTime).toBe(999);
  });
  it("reads legacy native file mappings and rejects malformed metadata", async () => {
    const initial = await prepareImport(emptyDataset(), [file()], "/synthetic", "sts2");
    const { fileRunIDs: _oldMapping, ...legacy } = initial;
    expect(validateDataset(legacy, "sts2").fileRunIDs).toEqual({ "/synthetic/a.run": "a.run" });
    expect(() => validateDataset({ ...initial, manifest: [] })).toThrow("文件清单");
    expect(() => validateDataset({ ...initial, importMetadata: { x: { modifiedAt: null, digest: "x", versions: [] } } })).toThrow("导入记录");
  });
  it("preserves separate legacy games without raw identity data", async () => {
    const initial = await prepareImport(emptyDataset(), [file(), file(raw(200), "/synthetic/b.run", 2)], "/synthetic", "sts2");
    for (const run of initial.runs) {
      delete run.raw;
      run.startTime = 0;
      run.seed = "";
    }
    initial.runs[1].runTime = 777;
    const preserved = await prepareImport(initial, [], "/synthetic", "sts2");
    expect(preserved.runs).toHaveLength(2);
  });
  it("rejects second-game progress in the first-game importer", async () => {
    await expect(prepareImport(emptyDataset(), [file("{}", "/synthetic/progress.save")], "/synthetic", "sts1")).rejects.toThrow("二代生涯");
  });
  it("ignores refresh timestamps when deciding whether to commit a transaction", async () => {
    const initial = await prepareImport(emptyDataset(), [file()], "/synthetic", "sts2");
    initial.importedAt = 10;
    const transaction = await prepareImportTransaction(initial, [file()], "/synthetic", "sts2");
    expect(transaction.changed).toBe(false);
    expect(transaction.dataset.importedAt).toBe(10);
    expect(JSON.parse(transaction.serialized)).toEqual(initial);
  });
});
