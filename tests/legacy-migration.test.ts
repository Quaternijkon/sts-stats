import { describe, expect, it } from "vitest";
import { normalizeRun } from "../Engine/domain/parser";
import { FOUNDATION_EPOCH, emptyDataset, prepareImport } from "../src/services/dataset";
import { legacyPreferences, prepareLegacyDataset } from "../src/services/legacyMigration";
import type { LegacySourceData, Preferences, SaveFile } from "../src/services/models";

const raw = (start: number) => ({ win: true, start_time: start, run_time: 600, seed: `synthetic-${start}`,
  players: [{ id: 1, character: "CHARACTER.IRONCLAD", deck: [], relics: [] }], map_point_history: [] });
const preferences: Preferences = { theme: "light", minimumSample: 1, autoSync: true,
  games: { sts1: { source: "", favorites: ["existing.run"] }, sts2: { source: "", favorites: [] } } };

describe("native application migration", () => {
  it("restores all four native filter scopes, favorites and local settings independently", () => {
    const result = legacyPreferences(preferences, {
      appearance: "dark", minimumSample: 7, favorites: ["old.run"],
      analysisFilter: { characters: ["Silent"], ascensions: [10], party: "coop", includeCards: ["must-not-enter-overview"] },
      objectFilter: { includeRelics: ["RELIC.SYNTHETIC"] }, soloRecordFilter: { outcomes: ["win"] },
      coopRecordFilter: { outcomes: ["loss"] }, "sts1.favorites": ["sts1.run"],
      "sts1.analysisFilter": { ascensions: [20] }, autoSyncEnabled: false,
      savedQueries: [{ id: "local-old-view" }],
    }, { sts2: { "old.run": ["retained-id.run"] } });
    expect(result.theme).toBe("dark");
    expect(result.minimumSample).toBe(7);
    expect(result.games.sts2.favorites).toEqual(["retained-id.run"]);
    expect(result.games.sts1.favorites).toEqual(["existing.run", "sts1.run"]);
    expect(result.games.sts2.pageFilters?.dashboard).toMatchObject({ characters: ["Silent"], ascensions: [10], party: "all", includeCards: [] });
    expect(result.games.sts2.pageFilters?.["objects/card"]).toMatchObject({ includeRelics: ["RELIC.SYNTHETIC"] });
    expect(result.games.sts2.pageFilters?.runs).toMatchObject({ outcomes: ["win"] });
    expect(result.games.sts2.pageFilters?.coop).toMatchObject({ outcomes: ["loss"] });
    expect(result.games.sts1.pageFilters?.dashboard).toMatchObject({ ascensions: [20] });
    expect(result.games.sts2.legacyAutoSync).toBe(false);
    expect(result.games.sts2.source).toBe("");
    expect(result.games.sts2.savedQueries).toEqual([{ id: "local-old-view" }]);
    expect(preferences.theme).toBe("light");
  });

  it("merges archived normalized saves and preserves Foundation dates and old IDs", async () => {
    const run = normalizeRun(raw(100), "original.run");
    const payload: LegacySourceData = {
      source: "/synthetic/old-profile", dataset: { ...emptyDataset(), runs: [run], source: "/synthetic/old-profile", importedAt: 12345 },
      runs: [{ id: "original.run", name: "original.run", importedAt: (FOUNDATION_EPOCH + 12345) * 1000,
        modified: 42, blob: "synthetic.json", versions: ["synthetic.json"], text: JSON.stringify(run) }], progress: null,
    };
    const result = await prepareLegacyDataset(payload, emptyDataset(), "sts2");
    const dataset = JSON.parse(result.serialized);
    expect(dataset.importedAt).toBe(12345);
    expect(dataset.runs).toHaveLength(1);
    expect(dataset.runs[0].id).toBe("original.run");
    expect(result.idMap["original.run"]).toBe("original.run");
  });

  it("adopts the paused sync setting for an already authorized directory", () => {
    const current = structuredClone(preferences);
    current.games.sts2.source = "/synthetic/authorized";
    current.games.sts2.autoSync = true;
    const next = legacyPreferences(current, { autoSyncEnabled: false });
    expect(next.games.sts2.autoSync).toBe(false);
    expect(next.games.sts2.legacyAutoSync).toBe(false);
    expect(next.games.sts2.source).toBe("/synthetic/authorized");
    expect(legacyPreferences(current, {}).games.sts2.autoSync).toBe(true);
  });

  it("keeps same-name different games and maps favorites to the new collision ID", async () => {
    const file: SaveFile = { name: "same.run", path: "/synthetic/same.run", text: JSON.stringify(raw(100)), modifiedAt: 10 };
    const base = await prepareImport(emptyDataset(), [file], "/synthetic", "sts2");
    const payload: LegacySourceData = { source: "/synthetic", dataset: null, progress: null,
      runs: [{ id: "same.run", name: "same.run", blob: "synthetic.run", versions: ["synthetic.run"],
        importedAt: 1700000000000, modified: 20, text: JSON.stringify(raw(200)) }] };
    const result = await prepareLegacyDataset(payload, base, "sts2");
    const dataset = JSON.parse(result.serialized);
    expect(dataset.runs).toHaveLength(2);
    expect(new Set(dataset.runs.map((run: { id: string }) => run.id)).size).toBe(2);
    expect(result.idMap["same.run"]).not.toBe("same.run");
    expect(base.runs).toHaveLength(1);
  });

  it("rejects a corrupt or cross-game source before producing any commit text", async () => {
    const payload: LegacySourceData = { source: "/synthetic", dataset: null, progress: null,
      runs: [{ id: "bad.run", name: "bad.run", blob: "bad.json", versions: ["bad.json"], importedAt: 0, modified: 0, text: "corrupted" }] };
    await expect(prepareLegacyDataset(payload, emptyDataset(), "sts2")).rejects.toThrow();
    payload.runs = [];
    payload.dataset = { ...emptyDataset(), source: "/synthetic", runs: [{ ...normalizeRun(raw(100), "synthetic.run"), gameVersion: "sts2" }] };
    await expect(prepareLegacyDataset(payload, emptyDataset(), "sts1")).rejects.toThrow("另一个游戏");
    expect(legacyPreferences(preferences, {}).games.sts2.pageFilters?.runs).toBeUndefined();
  });

  it("merges newer dataset-only revisions without reverting a newer existing snapshot", async () => {
    const base = { ...emptyDataset(), source: "/synthetic", importedAt: 100,
      runs: [normalizeRun(raw(100), "original.run")] };
    const revision = normalizeRun({ ...raw(100), win: false }, "renamed.run");
    const payload: LegacySourceData = { source: base.source, runs: [], progress: null,
      dataset: { ...base, importedAt: 200, runs: [revision] } };
    const newer = JSON.parse((await prepareLegacyDataset(payload, base, "sts2")).serialized);
    expect(newer.runs[0]).toMatchObject({ id: "original.run", status: "loss" });
    expect(newer.importedAt).toBe(200);
    payload.dataset = { ...base, importedAt: 50, runs: [revision] };
    const older = JSON.parse((await prepareLegacyDataset(payload, base, "sts2")).serialized);
    expect(older.runs[0].status).toBe("win");
    expect(older.importedAt).toBe(100);
  });

  it("preserves the import date of a progress-only archive", async () => {
    const payload: LegacySourceData = { source: "/synthetic", dataset: null, runs: [],
      progress: { id: "progress", name: "progress.save", modified: 0,
        importedAt: (FOUNDATION_EPOCH + 12345) * 1000, blob: "synthetic.json", versions: ["synthetic.json"],
        text: JSON.stringify({ characterStats: [], totalPlaytime: 60 }) } };
    const dataset = JSON.parse((await prepareLegacyDataset(payload, emptyDataset(), "sts2")).serialized);
    expect(dataset.importedAt).toBe(12345);
    expect(dataset.progress.totalPlaytime).toBe(60);
  });
});
