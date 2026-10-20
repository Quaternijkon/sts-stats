import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserDatabase } from "../src/services/browser/database";
import { emptyDataset } from "../src/services/dataset";
import { normalizeRun } from "../Engine/domain/parser";
import type { Dataset } from "../src/services/models";

const databases: BrowserDatabase[] = [];
function database(name = crypto.randomUUID()) { const db = new BrowserDatabase(name); databases.push(db); return db; }
function dataset(source = "/synthetic", start = 100): Dataset {
  return { ...emptyDataset(), source, importedAt: 12345, runs: [normalizeRun({ win: true, start_time: start, seed: `synthetic-${start}`,
    players: [{ id: 1, character: "Ironclad", deck: [], relics: [] }], map_point_history: [] }, "synthetic.run")] };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.close())); });

describe("browser authoritative storage", () => {
  it("persists large saves across connections, keeps summaries small, and isolates games", async () => {
    const name = crypto.randomUUID(), first = database(name);
    const value = dataset(); value.runs[0].raw.largeSyntheticField = "x".repeat(6 * 1024 * 1024);
    const text = JSON.stringify(value);
    const written = await first.saveDataset("sts2", value, text);
    const second = database(name), opened = await second.openDataset("sts2");
    expect(opened.identity).toBe(written.identity);
    expect(JSON.stringify(opened).length).toBeLessThan(4096);
    expect(await second.loadDatasetText("sts2", opened.identity)).toBe(text);
    expect((await second.openDataset("sts1")).dataset.runs).toHaveLength(0);
    expect(opened.dataset.importedAt).toBe(12345);
  });
  it("rejects stale writes and reads from another tab without losing either archive", async () => {
    const name = crypto.randomUUID(), first = database(name), second = database(name);
    const old = await second.openDataset("sts2");
    const value = dataset();
    const current = await first.saveDataset("sts2", value, JSON.stringify(value), old.identity);
    const other = dataset("/other", 200);
    await expect(second.saveDataset("sts2", other, JSON.stringify(other), old.identity)).rejects.toThrow("其他标签页");
    await expect(second.loadDatasetText("sts2", old.identity)).rejects.toThrow("其他标签页");
    expect(await second.listArchives("sts2")).toEqual([{ source: value.source, runs: 1, importedAt: 12345 }]);
    await second.saveDataset("sts2", other, JSON.stringify(other), current.identity);
    expect(await first.listArchives("sts2")).toHaveLength(2);
    await expect(first.activateArchive("sts2", value.source, current.identity)).rejects.toThrow("其他标签页");
    const restored = await first.activateArchive("sts2", value.source, (await first.openDataset("sts2")).identity);
    expect(restored.dataset.source).toBe(value.source);
  });
  it("rolls back dataset and archive checkpoints when a write fails part way through", async () => {
    const db = database(), original = dataset();
    const before = await db.saveDataset("sts2", original, JSON.stringify(original));
    const put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === "archiveMeta") throw new DOMException("Synthetic disk failure", "UnknownError");
      return put.apply(this, args);
    });
    const candidate = dataset("/candidate", 200);
    await expect(db.saveDataset("sts2", candidate, JSON.stringify(candidate), before.identity)).rejects.toThrow("Synthetic disk failure");
    failure.mockRestore();
    expect(await db.openDataset("sts2")).toEqual(before);
    expect(await db.loadDatasetText("sts2")).toBe(JSON.stringify(original));
    expect(await db.loadSourceText("sts2", candidate.source)).toBeNull();
  });
  it("migrates preview data and preferences only after the complete transaction commits", async () => {
    const db = database(), value = dataset();
    const values = new Map([
      ["sts2stats.dataset.sts2", JSON.stringify(value)],
      ["sts2stats.archive.sts2./old", JSON.stringify({ ...value, source: "/old" })],
      ["sts2stats.preferences", JSON.stringify({ theme: "dark", minimumSample: 7 })],
    ]);
    const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i],
      getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
    await db.migrateLegacy(storage);
    expect(values.size).toBe(0);
    expect((await db.openDataset("sts2")).dataset.importedAt).toBe(12345);
    expect(await db.listArchives("sts2")).toHaveLength(2);
    expect(await db.loadPreferences()).toMatchObject({ theme: "dark", minimumSample: 7 });
    values.set("sts2stats.dataset.sts2", "corrupt");
    await expect(db.migrateLegacy(storage)).rejects.toThrow();
    expect(values.get("sts2stats.dataset.sts2")).toBe("corrupt");
    expect((await db.openDataset("sts2")).dataset.source).toBe(value.source);
  });
  it("bounds disposable caches, ignores stale identities, and clears only the chosen game", async () => {
    const db = database(), value = dataset();
    const current = await db.saveDataset("sts2", value, JSON.stringify(value));
    vi.spyOn(Date, "now").mockReturnValue(10);
    for (let i = 0; i < 130; i++) await db.writeDerived("sts2", current.identity, `key-${i}`, "synthetic");
    const entries = await Promise.all(Array.from({ length: 130 }, (_, i) => db.readDerived("sts2", current.identity, `key-${i}`)));
    expect(entries.filter((entry) => entry != null)).toHaveLength(128);
    expect(entries[129]).toBe("synthetic");
    expect(await db.readDerived("sts2", "outdated", "key-129")).toBeNull();
    const otherGame = { ...emptyDataset(), source: "/synthetic-sts1" };
    await db.saveDataset("sts1", otherGame, JSON.stringify(otherGame));
    await db.clearDataset("sts2");
    expect(await db.listArchives("sts2")).toEqual([]);
    expect(await db.readDerived("sts2", current.identity, "key-129")).toBeNull();
    expect((await db.openDataset("sts1")).dataset.source).toBe(otherGame.source);
  });
});
