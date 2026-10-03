import { dispatch } from "../../Engine/bridge";
import { setCurrentGame, setGameCharacters } from "../../Engine/domain/game";
import type { Dataset, DatasetSnapshot, GameVersion } from "../services/models";
import type { WorkerStorage } from "./storage";
import { emptyDataset, validateDataset } from "../services/dataset";
import { storageSummary } from "./operations";

const cachedOperations = new Set([
  "dashboard", "restAnalysis", "query", "runs", "runPage", "coop", "arena", "archetypes",
  "entity", "ancients", "ancient", "career", "objects", "object",
]);
async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Full saves stay in this worker; a disk cache hit never needs to load them. */
export class AnalysisRuntime {
  private game: GameVersion = "sts2";
  private snapshot: DatasetSnapshot | null = null;
  private dataset: Dataset | null = null;
  private engineLoaded = false;
  private poolsReady = false;
  private cache = new Map<string, { result: unknown; bytes: number }>();
  private bytes = 0;
  constructor(private storage: WorkerStorage, private engine = dispatch) {}

  private clearMemory() { this.cache.clear(); this.bytes = 0; }
  private async ensureLoaded() {
    if (this.engineLoaded && this.poolsReady) return;
    if (!this.dataset) {
      if (!this.snapshot) throw new Error("分析数据尚未载入");
      const text = await this.storage.loadDatasetText(this.game, this.snapshot.identity);
      this.dataset = validateDataset(text ? JSON.parse(text) : emptyDataset(), this.game);
    }
    if (!this.engineLoaded) this.engine(JSON.stringify({ op: "load", game: this.game, ...this.dataset }));
    this.engineLoaded = true;
    let restored: unknown = null;
    if (this.snapshot) {
      try {
        const text = await this.storage.readDerived(this.game, this.snapshot.identity, "card-pools");
        if (text) restored = JSON.parse(text);
      } catch { /* A missing or corrupt cache is disposable. */ }
    }
    const pools = JSON.parse(this.engine(JSON.stringify({ op: "cardPoolCache", cache: restored })));
    this.poolsReady = true;
    if (this.snapshot && !pools.reused) {
      try { await this.storage.writeDerived(this.game, this.snapshot.identity, "card-pools", JSON.stringify(pools.cache)); }
      catch { /* A full/read-only cache must not stop analysis. */ }
    }
  }

  async handle(request: Record<string, unknown>): Promise<{ result: unknown; bytes: number }> {
    if (request.op === "open") {
      const snapshot = request.snapshot as DatasetSnapshot;
      const game = request.game as GameVersion;
      if (game !== this.game || snapshot.identity !== this.snapshot?.identity) {
        this.clearMemory();
        this.poolsReady = false;
        if (!request.keepLoaded || game !== this.game) {
          this.dataset = null;
          this.engineLoaded = false;
          this.poolsReady = false;
        }
      }
      this.game = game;
      this.snapshot = snapshot;
      setCurrentGame(game);
      setGameCharacters([
        ...snapshot.dataset.runs.flatMap((run) => [run.character, ...run.players.map((player) => player.character)]),
        ...(snapshot.dataset.progress?.characterStats ?? []).map((row) => row.character),
      ]);
      return { result: null, bytes: 0 };
    }
    if (request.op === "load") {
      // Staged imports cannot publish results under the previous disk identity.
      const result = JSON.parse(this.engine(JSON.stringify(request)));
      this.game = request.game as GameVersion;
      this.dataset = validateDataset(request, this.game);
      this.snapshot = null;
      this.engineLoaded = true;
      this.poolsReady = false;
      this.clearMemory();
      return { result, bytes: 0 };
    }
    if (request.op === "storageSummary") {
      const dataset = this.snapshot?.dataset ?? this.dataset;
      if (!dataset) throw new Error("分析数据尚未载入");
      const result = storageSummary(dataset);
      return { result, bytes: JSON.stringify(result).length * 2 };
    }
    if (["readDataset", "exportDataset"].includes(String(request.op))) {
      await this.ensureLoaded();
      const result = request.op === "readDataset" ? this.dataset : JSON.stringify(this.dataset, null, 2);
      return { result, bytes: typeof result === "string" ? result.length * 2 : 0 };
    }
    const key = JSON.stringify(request);
    const cacheable = cachedOperations.has(String(request.op));
    const memoryKey = `${this.snapshot?.identity ?? "staged"}|${key}`;
    const hit = this.cache.get(memoryKey);
    if (hit) {
      this.cache.delete(memoryKey);
      this.cache.set(memoryKey, hit);
      return hit;
    }
    const diskKey = cacheable && this.snapshot ? await digest(key) : null;
    let text: string | null = null;
    if (diskKey && this.snapshot) {
      try {
        text = await this.storage.readDerived(this.game, this.snapshot.identity, diskKey);
        if (text) JSON.parse(text);
      } catch { text = null; }
    }
    if (text == null) {
      if (!["catalog", "label", "csv"].includes(String(request.op))) await this.ensureLoaded();
      text = this.engine(key);
      if (diskKey && this.snapshot) {
        try { await this.storage.writeDerived(this.game, this.snapshot.identity, diskKey, text); }
        catch { /* Successful analysis does not depend on the cache. */ }
      }
    }
    const entry = { result: JSON.parse(text), bytes: text.length * 2 };
    if (cacheable && entry.bytes <= 4 * 1024 * 1024) {
      this.cache.set(memoryKey, entry);
      this.bytes += entry.bytes;
      while (this.cache.size > 36 || this.bytes > 32 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value!;
        this.bytes -= this.cache.get(oldest)!.bytes;
        this.cache.delete(oldest);
      }
    }
    return entry;
  }
}
