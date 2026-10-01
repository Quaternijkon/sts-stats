import { describe, expect, it } from "vitest";
import { AnalysisClient } from "../src/worker/client";
import { storageSummary } from "../src/worker/operations";
import { emptyDataset } from "../src/services/dataset";
import { normalizeRun } from "../Engine/domain/parser";
import { validateCareerProgress } from "../Engine/domain/schemas";
import type { CareerProgress, Dataset } from "../src/services/models";
import { arenaCsv, serializeCsv } from "../src/worker/exports";
import type { PreferenceArenaResult } from "../Engine/domain/preferenceArena";

class SyntheticWorker {
  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: Array<{ id: number; request: Record<string, unknown> }> = [];
  terminated = false;
  postMessage(message: { id: number; request: Record<string, unknown> }) {
    this.messages.push(message);
  }
  terminate() { this.terminated = true; }
  ready() { this.onmessage?.({ data: { ready: true } }); }
  respond(result: unknown, bytes = 100) {
    this.onmessage?.({ data: { id: this.messages.at(-1)!.id, result, bytes } });
  }
}

describe("worker scheduling and recovery", () => {
  it("rejects interrupted requests and restores the last loaded dataset after restart", async () => {
    const workers: SyntheticWorker[] = [];
    const client = new AnalysisClient(() => {
      const worker = new SyntheticWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const dataset = emptyDataset();
    const loaded = client.call({ op: "load", game: "sts2", ...dataset });
    workers[0].ready();
    workers[0].respond({ count: 0 });
    await loaded;
    const pending = client.call({ op: "dashboard" });
    const rejected = expect(pending).rejects.toThrow("synthetic failure");
    workers[0].onerror?.({ message: "synthetic failure" });
    await rejected;
    expect(workers[0].terminated).toBe(true);
    const recovered = client.callMeasured({ op: "dashboard" });
    expect(workers).toHaveLength(2);
    workers[0].ready();
    expect(workers[1].messages).toHaveLength(0);
    workers[1].ready();
    expect(workers[1].messages[0].request.op).toBe("load");
    workers[1].respond({ count: 0 });
    expect(workers[1].messages[1].request.op).toBe("dashboard");
    workers[1].respond({ summary: {} }, 222);
    await expect(recovered).resolves.toEqual({ result: { summary: {} }, bytes: 222 });
  });

  it("coalesces queued perspective requests without replacing the active request", async () => {
    const worker = new SyntheticWorker();
    const client = new AnalysisClient(() => worker as unknown as Worker);
    worker.ready();
    const first = client.call({ op: "dashboard", character: "Ironclad" }, "chart");
    const second = client.call({ op: "dashboard", character: "Silent" }, "chart");
    const rejected = expect(second).rejects.toThrow("新选择替代");
    const third = client.call({ op: "dashboard", character: "Defect" }, "chart");
    await rejected;
    worker.respond("first");
    await expect(first).resolves.toBe("first");
    expect(worker.messages.at(-1)!.request.character).toBe("Defect");
    worker.respond("third");
    await expect(third).resolves.toBe("third");
  });

  it("reports synchronous worker creation failures as rejected requests", async () => {
    const client = new AnalysisClient(() => { throw new Error("worker unavailable"); });
    await expect(client.call({ op: "dashboard" })).rejects.toThrow("worker unavailable");
  });
});

describe("local storage statistics", () => {
  it("separates party totals and preserves unknown progress counters", () => {
    const run = normalizeRun({ win: true, start_time: 100, run_time: 600, players: [{ id: 1, character: "CHARACTER.IRONCLAD", deck: [], relics: [] }], map_point_history: [] }, "synthetic.run");
    const dataset: Dataset = { ...emptyDataset(), runs: [run, { ...run, id: "coop.run", playerCount: 2, runTime: 300 }] };
    expect(storageSummary(dataset)).toEqual({ soloRuns: 1, coopRuns: 1, totalRuns: 2, soloTime: 600, coopTime: 300, totalTime: 900, progressTime: null, progressRecordedRuns: null });
    dataset.progress = validateCareerProgress({ characterStats: [{ character: "Ironclad", wins: 0, losses: 0 }], totalPlaytime: 0 });
    expect(storageSummary(dataset)).toMatchObject({ progressTime: 0, progressRecordedRuns: 0 });
  });
  it("requires complete finite nonnegative integer progress counts", () => {
    for (const row of [
      { wins: 5 }, { wins: 5, losses: -1 }, { wins: 5, losses: 0.5 },
      { wins: 5, losses: Infinity }, { wins: NaN, losses: 0 },
    ]) {
      const dataset = { ...emptyDataset(), progress: { characterStats: [{ character: "Ironclad", ...row }] } as CareerProgress };
      expect(storageSummary(dataset).progressRecordedRuns).toBeNull();
    }
    const dataset = { ...emptyDataset(), progress: validateCareerProgress({ characterStats: [{ character: "Ironclad", wins: 5, losses: 2 }, { character: "Silent", wins: 0, losses: 0 }] }) };
    expect(storageSummary(dataset).progressRecordedRuns).toBe(7);
    dataset.progress.characterStats.push({ character: "Defect", wins: 1 });
    expect(storageSummary(dataset).progressRecordedRuns).toBeNull();
  });
});

describe("worker CSV exports", () => {
  it("preserves missing values, recorded zeroes and embedded commas, quotes and newlines", () => {
    expect(serializeCsv(["value", "name"], [[null, 'x,"y"\nz'], [0, undefined]])).toBe(
      '\uFEFF"value","name"\n"","x,""y""\nz"\n"0",""',
    );
  });
  it("exports the ordered matrix without adding missing pair observations", () => {
    const result = { itemCategory: "cards", pairs: { "CARD.A¦CARD.B": {
      relation: "na", pref: null, prefCi: null, cooccurN: 0,
      rowChoiceCount: null, columnChoiceCount: null, otherChoiceCount: null,
      commonNeighbors: 0, shortestPath: null,
    } } } as unknown as PreferenceArenaResult;
    const lines = arenaCsv(result, ["CARD.B", "CARD.A"]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"不可比较","","0","","","","0",""');
    expect(arenaCsv(result, ["CARD.A"]).split("\n")).toHaveLength(1);
  });
});
