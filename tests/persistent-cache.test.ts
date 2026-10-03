import { describe, expect, it, vi } from "vitest";
import { AnalysisRuntime } from "../src/worker/runtime";
import { datasetSummary } from "../src/services/summary";
import { emptyDataset } from "../src/services/dataset";
import { normalizeRun } from "../Engine/domain/parser";
import type { DatasetSnapshot } from "../src/services/models";
import type { WorkerStorage } from "../src/worker/storage";

function fixture() {
  const run = normalizeRun({ win: true, start_time: 100, run_time: 600, seed: "synthetic",
    players: [{ id: 1, character: "CHARACTER.IRONCLAD", deck: [], relics: [] }], map_point_history: [] }, "synthetic.run");
  return { ...emptyDataset(), source: "/synthetic", runs: [run] };
}
function backing() {
  const disk = new Map<string, string>();
  const storage: WorkerStorage = {
    loadDatasetText: vi.fn(async () => JSON.stringify(fixture())),
    readDerived: vi.fn(async (game, identity, key) => disk.get(`${game}/${identity}/${key}`) ?? null),
    writeDerived: vi.fn(async (game, identity, key, text) => { disk.set(`${game}/${identity}/${key}`, text); }),
  };
  return { disk, storage };
}
function engine() {
  const calls: string[] = [];
  let count = 0;
  return {
    calls,
    dispatch: (input: string) => {
      const request = JSON.parse(input);
      calls.push(request.op);
      if (request.op === "load") { count = request.runs.length; return JSON.stringify({ count }); }
      if (request.op === "cardPoolCache") return JSON.stringify({ reused: request.cache != null, cache: { version: "synthetic", assignments: {} } });
      return JSON.stringify({ count });
    },
  };
}
const snapshot = (identity = "data-a"): DatasetSnapshot => ({ identity, dataset: datasetSummary(fixture()) });

describe("persistent analysis and lightweight startup", () => {
  it("opens summaries and serves cross-startup cache hits without loading full saves", async () => {
    const { storage } = backing();
    const firstEngine = engine();
    const first = new AnalysisRuntime(storage, firstEngine.dispatch);
    await first.handle({ op: "open", game: "sts2", snapshot: snapshot() });
    expect(storage.loadDatasetText).not.toHaveBeenCalled();
    expect((await first.handle({ op: "storageSummary" })).result).toMatchObject({ soloRuns: 1, totalTime: 600 });
    expect(storage.loadDatasetText).not.toHaveBeenCalled();
    await expect(first.handle({ op: "dashboard", filter: { ascensions: [10] } })).resolves.toMatchObject({ result: { count: 1 } });
    expect(storage.loadDatasetText).toHaveBeenCalledOnce();
    const secondEngine = engine();
    const second = new AnalysisRuntime(storage, secondEngine.dispatch);
    await second.handle({ op: "open", game: "sts2", snapshot: snapshot() });
    await expect(second.handle({ op: "dashboard", filter: { ascensions: [10] } })).resolves.toMatchObject({ result: { count: 1 } });
    expect(storage.loadDatasetText).toHaveBeenCalledOnce();
    expect(secondEngine.calls).toEqual([]);
    await second.handle({ op: "dashboard", filter: { ascensions: [0] } });
    expect(storage.loadDatasetText).toHaveBeenCalledTimes(2);
    expect(storage.readDerived).toHaveBeenCalledWith("sts2", "data-a", "card-pools");
  });

  it("invalidates changed dataset or engine identities and falls back after cache corruption", async () => {
    const { storage, disk } = backing();
    const first = new AnalysisRuntime(storage, engine().dispatch);
    await first.handle({ op: "open", game: "sts2", snapshot: snapshot() });
    await first.handle({ op: "dashboard" });
    for (const key of disk.keys()) if (!key.endsWith("card-pools")) disk.set(key, "corrupted");
    const fallbackEngine = engine();
    const fallback = new AnalysisRuntime(storage, fallbackEngine.dispatch);
    await fallback.handle({ op: "open", game: "sts2", snapshot: snapshot() });
    await fallback.handle({ op: "dashboard" });
    expect(fallbackEngine.calls).toContain("dashboard");
    const changedEngine = engine();
    const changed = new AnalysisRuntime(storage, changedEngine.dispatch);
    await changed.handle({ op: "open", game: "sts2", snapshot: snapshot("engine-or-data-b") });
    await changed.handle({ op: "dashboard" });
    expect(changedEngine.calls).toContain("load");
  });

  it("retains warm results across game selection and ignores cache write failures", async () => {
    const { storage } = backing();
    vi.mocked(storage.writeDerived).mockRejectedValue(new Error("synthetic full cache"));
    const model = engine();
    const runtime = new AnalysisRuntime(storage, model.dispatch);
    await runtime.handle({ op: "open", game: "sts2", snapshot: snapshot() });
    await runtime.handle({ op: "dashboard" });
    await runtime.handle({ op: "open", game: "sts2", snapshot: snapshot() });
    await runtime.handle({ op: "dashboard" });
    expect(model.calls.filter((op) => op === "dashboard")).toHaveLength(1);
  });
});
