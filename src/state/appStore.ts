import { create } from "zustand";
import { EMPTY_FILTER, filterSpecSchema } from "../../Engine/domain/schemas";
import { setCurrentGame, setGameCharacters } from "../../Engine/domain/game";
import type { ObjectKind } from "../../Engine/domain/objectTypes";
import { analysisClient } from "../worker/client";
import { platform } from "../services/platform";
import { emptyDataset } from "../services/dataset";
import type { ImportTransaction } from "../services/dataset";
import type { Dataset, GameVersion, FilterSpec, Preferences, SaveFile } from "../services/models";

const defaults: Preferences = {
  theme: "system", minimumSample: 1, autoSync: true,
  games: {
    sts1: { source: "", favorites: [], autoSync: true },
    sts2: { source: "", favorites: [], autoSync: true },
  },
};
let preferences = structuredClone(defaults);
let persistQueue = Promise.resolve();
let selection = 0;
let initialization: Promise<void> | null = null;
let activeOperation: Promise<void> | null = null;
const pages: Record<GameVersion, string> = { sts1: "dashboard", sts2: "dashboard" };
const loaded: Partial<Record<GameVersion, Dataset>> = {};
const engineQueues: Record<GameVersion, Promise<void>> = {
  sts1: Promise.resolve(), sts2: Promise.resolve(),
};
const generations: Record<GameVersion, number> = { sts1: 0, sts2: 0 };
const checkingSync = new Set<GameVersion>();
type HistoryEntry = { page: string; filter: FilterSpec };
const backStacks: Record<GameVersion, HistoryEntry[]> = { sts1: [], sts2: [] };
type SyncState = {
  candidate?: string; committed?: string; verifiedAt: number;
  error: string | null; status: string; pending: boolean;
};
const syncStates: Record<GameVersion, SyncState> = {
  sts1: { verifiedAt: 0, error: null, status: "未选择同步文件夹", pending: false },
  sts2: { verifiedAt: 0, error: null, status: "未选择同步文件夹", pending: false },
};
function filterScope(page: string): string {
  if (page.startsWith("object/")) return "detail/object/" + page.split("/")[1];
  if (page.startsWith("run/")) return "detail/run";
  return page;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function persist() {
  const snapshot = structuredClone(preferences);
  persistQueue = persistQueue.catch(() => {}).then(() => platform.savePreferences(snapshot));
  persistQueue.catch((error) => useAppStore.setState({ error: message(error) }));
}
/** Loads and mutations share a queue per worker, including game switches. */
function withEngine<T>(game: GameVersion, operation: () => Promise<T>): Promise<T> {
  const result = engineQueues[game].catch(() => {}).then(operation);
  engineQueues[game] = result.then(() => {}, () => {});
  return result;
}
function cleanPreferences(value: Preferences): Preferences {
  const result = structuredClone(defaults);
  if (["system", "light", "dark"].includes(value.theme)) result.theme = value.theme;
  if (Number.isInteger(value.minimumSample))
    result.minimumSample = Math.max(1, Math.min(1000, value.minimumSample));
  if (typeof value.autoSync === "boolean") result.autoSync = value.autoSync;
  for (const game of ["sts1", "sts2"] as const) {
    const saved = value.games?.[game];
    if (!saved || typeof saved !== "object") continue;
    result.games[game] = {
      source: typeof saved.source === "string" && !saved.source.includes("\n") ? saved.source : "",
      favorites: Array.isArray(saved.favorites) ? [...new Set(saved.favorites.filter((id) => typeof id === "string"))] : [],
      autoSync: typeof saved.autoSync === "boolean" ? saved.autoSync : result.autoSync,
    };
    if (Number.isFinite(saved.lastSyncedAt)) result.games[game].lastSyncedAt = saved.lastSyncedAt;
    const filter = filterSpecSchema.safeParse(saved.filter);
    if (filter.success) result.games[game].filter = filter.data;
    if (saved.pageFilters && typeof saved.pageFilters === "object") {
      result.games[game].pageFilters = {};
      for (const [page, value] of Object.entries(saved.pageFilters)) {
        const parsed = filterSpecSchema.safeParse(value);
        if (parsed.success) result.games[game].pageFilters![page] = parsed.data;
      }
    }
  }
  return result;
}
interface AppState {
  game: GameVersion;
  page: string;
  dataset: Dataset;
  characters: string[];
  filter: FilterSpec;
  revision: number;
  ready: boolean;
  busy: boolean;
  error: string | null;
  favorites: string[];
  settings: Pick<Preferences, "theme" | "minimumSample" | "autoSync">;
  syncSource: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: number | null;
  initialize(): Promise<void>;
  selectGame(game: GameVersion): Promise<void>;
  navigate(page: string): void;
  openRun(id: string): void;
  openObject(kind: ObjectKind, id: string): void;
  back(): void;
  setFilter(patch: Partial<FilterSpec>): void;
  resetFilter(): void;
  toggleFavorite(id: string): void;
  setSettings(patch: Partial<AppState["settings"]>): void;
  importFiles(files: SaveFile[], source: string, syncDirectory?: string): Promise<void>;
  importDirectory(): Promise<void>;
  importDropped(): Promise<void>;
  importSingleFiles(): Promise<void>;
  sync(immediately?: boolean): Promise<void>;
  syncAll(immediately?: boolean): Promise<void>;
  importExistingDataset(): Promise<void>;
  clearData(): Promise<void>;
  dismissError(): void;
}
export const useAppStore = create<AppState>((set, get) => {
  function rememberContext(): HistoryEntry {
    const context = { page: get().page, filter: structuredClone(get().filter) };
    const game = get().game;
    backStacks[game] = [...backStacks[game], context].slice(-64);
    return context;
  }
  function drainPendingSync() {
    if (get().busy) return;
    for (const game of ["sts1", "sts2"] as const) {
      if (syncStates[game].pending && !checkingSync.has(game)) {
        syncStates[game].pending = false;
        setTimeout(() => { void syncGame(game, true); }, 0);
      }
    }
  }
  function publishSync(game: GameVersion) {
    if (get().game !== game) return;
    const saved = preferences.games[game];
    set({ syncSource: saved.source, syncStatus: syncStates[game].status,
      syncError: syncStates[game].error, lastSyncedAt: saved.lastSyncedAt ?? null,
      settings: { ...get().settings, autoSync: saved.autoSync ?? preferences.autoSync } });
  }
  function publishDataset(game: GameVersion, dataset: Dataset) {
    loaded[game] = dataset;
    if (get().game !== game) return;
    setCurrentGame(game);
    const characters = [...setGameCharacters([
      ...dataset.runs.flatMap((r) => [r.character, ...r.players.map((p) => p.character)]),
      ...(dataset.progress?.characterStats ?? []).map((s) => s.character),
    ])];
    set((state) => ({ dataset, characters, ready: true, revision: state.revision + 1 }));
  }
  function stopSource(game: GameVersion) {
    generations[game] += 1;
    preferences.games[game].source = "";
    preferences.games[game].autoSync = false;
    delete preferences.games[game].lastSyncedAt;
    syncStates[game] = { verifiedAt: 0, error: null, status: "未选择同步文件夹", pending: false };
    publishSync(game);
    persist();
  }
  function recordSuccess(game: GameVersion, snapshot?: string) {
    const state = syncStates[game];
    state.committed = snapshot;
    state.candidate = snapshot;
    state.verifiedAt = Date.now();
    state.error = null;
    state.status = preferences.games[game].source
      ? preferences.games[game].autoSync ? "已同步" : "已暂停" : "未选择同步文件夹";
    if (preferences.games[game].source) preferences.games[game].lastSyncedAt = Date.now();
    publishSync(game);
    persist();
  }
  async function currentDataset(game: GameVersion): Promise<Dataset> {
    const existing = loaded[game];
    if (existing) return existing;
    const dataset = await analysisClient(game).call<Dataset>({ op: "validateDataset", game,
      dataset: await platform.loadDataset(game) ?? emptyDataset() });
    loaded[game] = dataset;
    return dataset;
  }
  async function commit(game: GameVersion, dataset: Dataset, previous: Dataset, files?: SaveFile[], serialized?: string) {
    // Validate worker loading before publishing disk state; restore it if writing fails.
    await analysisClient(game).call({ op: "load", game, ...dataset });
    try {
      const text = serialized ?? await analysisClient(game).call<string>({ op: "serializeDataset", dataset });
      await platform.saveDataset(game, dataset, files, text);
    } catch (error) {
      await analysisClient(game).call({ op: "load", game, ...previous });
      throw error;
    }
    publishDataset(game, dataset);
  }
  async function importForGame(game: GameVersion, files: SaveFile[], source: string, generation: number, accept = () => true) {
    const previous = await currentDataset(game);
    let base = previous;
    if (previous.source !== source) {
      const archived = await platform.loadSourceDataset(game, source);
      base = archived ? await analysisClient(game).call<Dataset>({ op: "validateDataset", game, dataset: archived }) : emptyDataset();
    }
    const transaction = await analysisClient(game).call<ImportTransaction>({
      op: "prepareImportTransaction", previous: base, current: previous, files, source, game,
    });
    if (generation !== generations[game] || !accept()) return false;
    if (transaction.changed) await commit(game, transaction.dataset, previous, files, transaction.serialized);
    else if (get().game === game && !get().ready) publishDataset(game, previous);
    return true;
  }
  async function operation(game: GameVersion, action: () => Promise<void>, clearError = true) {
    if (get().busy) return;
    set(clearError ? { busy: true, error: null } : { busy: true });
    const running = withEngine(game, action).catch((error) => {
      if (!clearError) throw error;
      if (get().game === game) set({ error: message(error) });
    }).finally(() => {
      set({ busy: false });
      activeOperation = null;
      drainPendingSync();
    });
    activeOperation = running;
    await running;
  }
  async function selectedImport(game: GameVersion, files: SaveFile[], source: string, directory: string) {
    // A failed new selection also retires the previous source subscription.
    stopSource(game);
    if (!await importForGame(game, files, source, generations[game])) return;
    preferences.games[game].source = directory;
    preferences.games[game].autoSync = !!directory;
    recordSuccess(game);
  }
  async function chooseSource<T>(game: GameVersion, choose: () => Promise<T>): Promise<T> {
    try {
      return await choose();
    } catch (error) {
      // Native selectors return read errors only after the user chose a new source.
      stopSource(game);
      throw error;
    }
  }
  async function syncGame(game: GameVersion, immediately: boolean) {
    const saved = preferences.games[game];
    if (!saved.source || (!immediately && !saved.autoSync)) return;
    if (get().busy) {
      if (immediately) syncStates[game].pending = true;
      return;
    }
    const source = saved.source;
    const generation = generations[game];
    if (checkingSync.has(game)) {
      if (immediately) syncStates[game].pending = true;
      return;
    }
    checkingSync.add(game);
    const state = syncStates[game];
    try {
      const before = await platform.snapshotDirectory(source);
      if (generation !== generations[game]) return;
      const stable = state.candidate === before;
      state.candidate = before;
      if (!immediately && (!stable || (state.committed === before && Date.now() - state.verifiedAt < 60_000))) return;
      if (get().busy) {
        if (immediately) state.pending = true;
        return;
      }
      await operation(game, async () => {
        if (generation !== generations[game]) return;
        state.status = "正在同步";
        publishSync(game);
        const resolved = await platform.resolveDirectory(source);
        const files = await platform.scanDirectory(source);
        const after = await platform.snapshotDirectory(source);
        if (before !== after || resolved !== await platform.resolveDirectory(source))
          throw new Error("存档正在写入，请稍后重试");
        if (generation !== generations[game] || (!immediately && !preferences.games[game].autoSync)) return;
        if (await importForGame(game, files, resolved, generation,
          () => immediately || !!preferences.games[game].autoSync)) recordSuccess(game, after);
      }, false);
    } catch (error) {
      if (generation !== generations[game]) return;
      delete state.committed;
      state.error = message(error);
      state.status = preferences.games[game].autoSync ? "同步失败，将自动重试" : "同步失败";
      publishSync(game);
    } finally {
      checkingSync.delete(game);
      drainPendingSync();
    }
  }
  return {
    game: "sts2", page: "home", dataset: emptyDataset(),
    characters: ["Ironclad", "Silent", "Regent", "Necrobinder", "Defect"],
    filter: structuredClone(EMPTY_FILTER), revision: 0, ready: false, busy: false, error: null,
    favorites: [], settings: { theme: "system", minimumSample: 1, autoSync: true },
    syncSource: "", syncStatus: "未选择同步文件夹", syncError: null, lastSyncedAt: null,
    async initialize() {
      if (initialization) return initialization;
      initialization = (async () => {
        try {
          const saved = await platform.loadPreferences();
          if (saved) preferences = cleanPreferences(saved);
          for (const game of ["sts1", "sts2"] as const)
            syncStates[game].status = preferences.games[game].source
              ? preferences.games[game].autoSync ? "等待同步" : "已暂停" : "未选择同步文件夹";
          set({ settings: { theme: preferences.theme, minimumSample: preferences.minimumSample,
            autoSync: preferences.games[get().game].autoSync ?? preferences.autoSync } });
          publishSync(get().game);
        } catch (error) { set({ error: message(error), ready: false }); }
      })();
      return initialization;
    },
    async selectGame(game) {
      await get().initialize();
      const token = ++selection;
      set({ game, ready: false, dataset: emptyDataset(),
        filter: { ...structuredClone(EMPTY_FILTER),
          ...(preferences.games[game].pageFilters?.[filterScope(pages[game])] ?? preferences.games[game].filter) },
        favorites: preferences.games[game].favorites, page: pages[game], error: null });
      publishSync(game);
      try {
        await withEngine(game, async () => {
          if (token !== selection) return;
          const dataset = await currentDataset(game);
          await analysisClient(game).call({ op: "load", game, ...dataset });
          if (token === selection) publishDataset(game, dataset);
        });
      } catch (error) { if (token === selection) set({ error: message(error), ready: false }); }
    },
    navigate(page) {
      const game = get().game;
      const saved = preferences.games[game];
      saved.pageFilters = { ...saved.pageFilters, [filterScope(get().page)]: get().filter };
      if (page !== "home") pages[game] = page;
      const filter = { ...structuredClone(EMPTY_FILTER), ...(saved.pageFilters[filterScope(page)] ?? {}) };
      set({ page, filter });
      persist();
    },
    openRun(id) {
      const context = rememberContext();
      get().navigate("run/" + encodeURIComponent(id));
      get().setFilter(context.filter);
    },
    openObject(kind, id) {
      const context = rememberContext();
      get().navigate("object/" + kind + "/" + encodeURIComponent(id));
      get().setFilter(context.filter);
    },
    back() {
      const entry = backStacks[get().game].pop();
      get().navigate(entry?.page ?? "dashboard");
      if (entry) get().setFilter(entry.filter);
    },
    setFilter(patch) {
      const filter = { ...get().filter, ...patch };
      const saved = preferences.games[get().game];
      saved.filter = filter;
      saved.pageFilters = { ...saved.pageFilters, [filterScope(get().page)]: filter };
      set({ filter });
      persist();
    },
    resetFilter() { get().setFilter(structuredClone(EMPTY_FILTER)); },
    toggleFavorite(id) {
      const favorites = get().favorites.includes(id) ? get().favorites.filter((f) => f !== id) : [...get().favorites, id];
      preferences.games[get().game].favorites = favorites;
      set({ favorites });
      persist();
    },
    setSettings(patch) {
      if (patch.autoSync !== undefined) {
        const game = get().game;
        preferences.games[game].autoSync = patch.autoSync;
        syncStates[game].status = preferences.games[game].source
          ? patch.autoSync ? "等待同步" : "已暂停" : "未选择同步文件夹";
        publishSync(game);
        if (patch.autoSync) void syncGame(game, true);
      }
      Object.assign(preferences, { ...patch, autoSync: preferences.autoSync });
      set({ settings: { ...get().settings, ...patch } });
      persist();
    },
    async importFiles(files, source, directory = source.includes("\n") ? "" : source) {
      const game = get().game;
      await operation(game, () => selectedImport(game, files, source, directory));
    },
    async importDirectory() {
      const game = get().game;
      await operation(game, async () => {
        const selected = await chooseSource(game, () => platform.chooseDirectory());
        if (selected) await selectedImport(game, selected.files, selected.source ?? selected.directory, selected.directory);
      });
    },
    async importDropped() {
      const game = get().game;
      await operation(game, async () => {
        const selected = await chooseSource(game, () => platform.takeDroppedSources());
        if (!selected) return;
        const directory = selected.directory.includes("\n") ? "" : selected.directory;
        await selectedImport(game, selected.files, selected.source ?? selected.directory, directory);
        if (get().game === game && !get().error && get().page === "home") get().navigate("dashboard");
      });
    },
    async importSingleFiles() {
      const game = get().game;
      await operation(game, async () => {
        const files = await chooseSource(game, () => platform.chooseFiles());
        if (files.length) await selectedImport(game, files, "files:\n" + [...new Set(files.map((file) => file.path))].sort().join("\n"), "");
      });
    },
    async sync(immediately = true) { await syncGame(get().game, immediately); },
    async syncAll(immediately = false) {
      await get().initialize();
      for (const game of ["sts1", "sts2"] as const) {
        if (preferences.games[game].autoSync === true) await syncGame(game, immediately);
      }
    },
    async importExistingDataset() {
      const game = get().game;
      await operation(game, async () => {
        const imported = await chooseSource(game, () => platform.importDataset());
        if (!imported) return;
        stopSource(game);
        const previous = await currentDataset(game);
        const dataset = await analysisClient(game).call<Dataset>({ op: "validateDataset", game, dataset: imported });
        await commit(game, dataset, previous);
      });
    },
    async clearData() {
      const game = get().game;
      stopSource(game);
      // Stop the subscription first, then let an atomic write finish before deleting.
      while (activeOperation) await activeOperation.catch(() => {});
      stopSource(game);
      await operation(game, async () => {
        const dataset = emptyDataset();
        // Publish an empty checkpoint first, matching the native clear operation.
        // A later archive-cleanup error cannot leave the UI displaying deleted runs.
        await commit(game, dataset, loaded[game] ?? emptyDataset());
        await platform.clearDataset(game);
        preferences.games[game] = { source: "", favorites: [], autoSync: false };
        backStacks[game] = [];
        pages[game] = "dashboard";
        publishSync(game);
        if (get().game === game) set({ favorites: [], filter: structuredClone(EMPTY_FILTER), page: "dashboard" });
        persist();
      });
    },
    dismissError() { set({ error: null }); },
  };
});
