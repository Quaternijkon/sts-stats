import { create } from "zustand";
import { EMPTY_FILTER, filterSpecSchema } from "../../Engine/domain/schemas";
import { setCurrentGame, setGameCharacters } from "../../Engine/domain/game";
import type { ObjectKind } from "../../Engine/domain/objectTypes";
import { analysisClient } from "../worker/client";
import { platform } from "../services/platform";
import { emptyDataset } from "../services/dataset";
import type { ImportTransaction } from "../services/dataset";
import type { Dataset, DatasetSnapshot, DatasetSummary, GameVersion, FilterSpec, Preferences, SaveFile, LegacySelection } from "../services/models";
import type { AccountSyncSettings, PreparedCloud } from "../services/sync/types";

const defaults: Preferences = {
  selectedGame: "sts2",
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
const loaded: Partial<Record<GameVersion, DatasetSnapshot>> = {};
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
function pageFilter(page: string, filter: FilterSpec): FilterSpec {
  return ["dashboard", "rest"].includes(page) ? {
    ...filter, party: "all", includeCards: [], excludeCards: [], includeRelics: [], excludeRelics: [],
  } : { ...filter, party: "all" };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function persist() {
  const snapshot = structuredClone(preferences);
  let checkpoint: string | undefined;
  let journalError: string | null = null;
  try { checkpoint = platform.stagePreferences?.(snapshot); }
  catch { journalError = "偏好尚在保存，请等待完成后再刷新页面"; useAppStore.setState({ error: journalError }); }
  persistQueue = persistQueue.catch(() => {}).then(() => platform.savePreferences(snapshot, checkpoint)).then(() => {
    if (journalError && useAppStore.getState().error === journalError) useAppStore.setState({ error: null });
  });
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
  if (value.accountSync && typeof value.accountSync === "object") {
    const saved = value.accountSync;
    result.accountSync = { enabled: saved.enabled === true, accountId: typeof saved.accountId === "string" ? saved.accountId : undefined, games: {} };
    for (const game of ["sts1", "sts2"] as const) {
      const checkpoint = saved.games?.[game];
      if (checkpoint && Number.isSafeInteger(checkpoint.revision) && checkpoint.revision > 0 &&
        /^[a-f0-9]{64}$/.test(checkpoint.fingerprint) && Number.isFinite(checkpoint.updated)) result.accountSync.games[game] = checkpoint;
    }
  }
  if (value.selectedGame === "sts1" || value.selectedGame === "sts2") result.selectedGame = value.selectedGame;
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
    if (typeof saved.legacyAutoSync === "boolean") result.games[game].legacyAutoSync = saved.legacyAutoSync;
    if (Array.isArray(saved.savedQueries)) result.games[game].savedQueries = saved.savedQueries;
    const filter = filterSpecSchema.safeParse(saved.filter);
    if (filter.success) result.games[game].filter = filter.data;
    if (saved.pageFilters && typeof saved.pageFilters === "object") {
      result.games[game].pageFilters = {};
      for (const [page, value] of Object.entries(saved.pageFilters)) {
        const parsed = filterSpecSchema.safeParse(value);
        if (parsed.success) result.games[game].pageFilters![page] = pageFilter(page, parsed.data);
      }
    }
  }
  return result;
}
interface AppState {
  accountSync: AccountSyncSettings;
  setAccountSync(settings: AccountSyncSettings): Promise<void>;
  prepareAccountSnapshot(game: GameVersion, includePayload?: boolean): Promise<PreparedCloud & { identity: string; favorites: string }>;
  applyAccountSnapshot(game: GameVersion, text: string, accountId: string, identity: string, favorites: string): Promise<void>;
  game: GameVersion;
  page: string;
  dataset: DatasetSummary;
  characters: string[];
  filter: FilterSpec;
  revision: number;
  archiveRevision: number;
  ready: boolean;
  busy: boolean;
  error: string | null;
  favorites: string[];
  settings: Pick<Preferences, "theme" | "minimumSample" | "autoSync">;
  syncSource: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: number | null;
  migrationStatus: string | null;
  initialize(): Promise<void>;
  refreshPreferences(): Promise<void>;
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
  restoreArchive(source: string): Promise<void>;
  migrateLegacy(selection: LegacySelection, ids: string[], active: Partial<Record<GameVersion, string>>, usePreferences: boolean): Promise<boolean>;
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
  function publishDataset(game: GameVersion, snapshot: DatasetSnapshot) {
    const changed = loaded[game]?.identity !== snapshot.identity;
    loaded[game] = snapshot;
    if (get().game !== game) return;
    const dataset = snapshot.dataset;
    setCurrentGame(game);
    const characters = [...setGameCharacters([
      ...dataset.runs.flatMap((r) => [r.character, ...r.players.map((p) => p.character)]),
      ...(dataset.progress?.characterStats ?? []).map((s) => s.character),
    ])];
    set((state) => ({ dataset, characters, ready: true, revision: state.revision + (changed ? 1 : 0) }));
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
    const snapshot = await platform.openDataset(game);
    await analysisClient(game).call({ op: "open", game, snapshot });
    if (get().ready && loaded[game]?.identity !== snapshot.identity) publishDataset(game, snapshot);
    else loaded[game] = snapshot;
    return analysisClient(game).call<Dataset>({ op: "readDataset" });
  }
  async function commit(game: GameVersion, dataset: Dataset, previous: Dataset, files?: SaveFile[], serialized?: string) {
    // Validate worker loading before publishing disk state; restore it if writing fails.
    const checkpoint = loaded[game] ?? await platform.openDataset(game);
    await analysisClient(game).call({ op: "load", game, ...dataset });
    let snapshot: DatasetSnapshot;
    try {
      const text = serialized ?? await analysisClient(game).call<string>({ op: "serializeDataset", dataset });
      snapshot = await platform.saveDataset(game, dataset, files, text, checkpoint.identity);
    } catch (error) {
      await analysisClient(game).call({ op: "load", game, ...previous });
      await analysisClient(game).call({ op: "open", game, snapshot: checkpoint, keepLoaded: true });
      throw error;
    }
    await analysisClient(game).call({ op: "open", game, snapshot, keepLoaded: true });
    publishDataset(game, snapshot);
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
    else if (get().game === game && !get().ready && loaded[game]) publishDataset(game, loaded[game]!);
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
    preferences.games[game].autoSync = !!directory && (preferences.games[game].legacyAutoSync ?? true);
    delete preferences.games[game].legacyAutoSync;
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
      const before = await platform.snapshotDirectory(source, game);
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
        const resolved = await platform.resolveDirectory(source, game);
        const files = await platform.scanDirectory(source, game);
        const after = await platform.snapshotDirectory(source, game);
        if (before !== after || resolved !== await platform.resolveDirectory(source, game))
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
    accountSync: { enabled: false, games: {} },
    async setAccountSync(settings) {
      preferences.accountSync = structuredClone(settings);
      set({ accountSync: preferences.accountSync });
      persist();
      await persistQueue;
    },
    async prepareAccountSnapshot(game, includePayload = false) {
      if (get().busy) throw new Error("本地数据正在更新，请稍后同步");
      return withEngine(game, async () => {
        const snapshot = await platform.openDataset(game);
        await analysisClient(game).call({ op: "open", game, snapshot });
        if (get().ready && loaded[game]?.identity !== snapshot.identity) publishDataset(game, snapshot);
        else loaded[game] = snapshot;
        const favorites = [...preferences.games[game].favorites];
        const result = await analysisClient(game).call<PreparedCloud>({ op: "prepareCurrentCloud", includePayload, favorites, game });
        return { ...result, identity: loaded[game]!.identity, favorites: JSON.stringify(favorites) };
      });
    },
    async applyAccountSnapshot(game, text, accountId, identity, favorites) {
      if (get().busy) throw new Error("本地数据正在更新，请稍后同步");
      await operation(game, async () => {
        const previous = await currentDataset(game);
        const guard = () => {
          if (get().accountSync.accountId !== accountId || !get().accountSync.enabled) throw new Error("账户同步状态已更改，本机数据保留");
          if (JSON.stringify(preferences.games[game].favorites) !== favorites) throw new Error("本机收藏已更新，请重新同步");
        };
        guard();
        if (loaded[game]!.identity !== identity) throw new Error("本机数据已更新，请重新同步");
        const remote = await analysisClient(game).call<Awaited<ReturnType<typeof import("../services/sync/payload")["parseCloud"]>>>({ op: "parseCloud", game, text });
        const local = await analysisClient(game).call<PreparedCloud>({ op: "prepareCloud", dataset: previous, favorites: preferences.games[game].favorites, game });
        guard();
        if (local.datasetFingerprint !== remote.datasetFingerprint) {
          // Save a separate source archive before a cloud replacement, including conflicts.
          if (previous.runs.length || previous.progress) {
            const backup = { ...previous, source: `同步备份 ${new Date().toISOString()} ${crypto.randomUUID().slice(0, 8)}` };
            await commit(game, backup, previous);
          }
          guard();
          const dataset = { ...remote.dataset, source: previous.source || `account:${accountId}:${game}`,
            manifest: previous.manifest, fileRunIDs: previous.fileRunIDs, importMetadata: previous.importMetadata };
          await commit(game, dataset, previous);
        }
        guard();
        preferences.games[game].favorites = remote.favorites;
        if (get().game === game) set({ favorites: remote.favorites });
        set((state) => ({ archiveRevision: state.archiveRevision + 1 }));
        persist();
        await persistQueue;
      }, false);
    },
    game: "sts2", page: "home", dataset: emptyDataset(),
    characters: ["Ironclad", "Silent", "Regent", "Necrobinder", "Defect"],
    filter: structuredClone(EMPTY_FILTER), revision: 0, archiveRevision: 0, ready: false, busy: false, error: null,
    favorites: [], settings: { theme: "system", minimumSample: 1, autoSync: true },
    syncSource: "", syncStatus: "未选择同步文件夹", syncError: null, lastSyncedAt: null, migrationStatus: null,
    async initialize() {
      if (initialization) return initialization;
      initialization = (async () => {
        try {
          const saved = await platform.loadPreferences();
          if (saved) preferences = cleanPreferences(saved);
          for (const game of ["sts1", "sts2"] as const)
            syncStates[game].status = preferences.games[game].source
              ? preferences.games[game].autoSync ? "等待同步" : "已暂停" : "未选择同步文件夹";
          set({ accountSync: preferences.accountSync ?? { enabled: false, games: {} }, game: preferences.selectedGame ?? get().game, settings: { theme: preferences.theme, minimumSample: preferences.minimumSample,
            autoSync: preferences.games[get().game].autoSync ?? preferences.autoSync } });
          publishSync(get().game);
        } catch (error) { set({ error: message(error), ready: false }); }
      })();
      return initialization;
    },
    async refreshPreferences() {
      if (get().migrationStatus) return;
      const value = await platform.loadPreferences();
      if (!value) return;
      const next = cleanPreferences(value);
      for (const game of ["sts1", "sts2"] as const) {
        const old = preferences.games[game], current = next.games[game];
        if (old.source !== current.source || old.autoSync !== current.autoSync) {
          generations[game] += 1;
          syncStates[game] = { verifiedAt: 0, error: null, pending: false, status: current.source
            ? current.autoSync ? "等待同步" : "已暂停" : "未选择同步文件夹" };
        }
      }
      preferences = next;
      const current = preferences.games[get().game];
      set({ accountSync: next.accountSync ?? { enabled: false, games: {} }, favorites: current.favorites, settings: { theme: next.theme, minimumSample: next.minimumSample, autoSync: current.autoSync ?? next.autoSync },
        filter: pageFilter(get().page, { ...structuredClone(EMPTY_FILTER), ...(current.pageFilters?.[filterScope(get().page)] ?? get().filter) }) });
      publishSync(get().game);
    },
    async selectGame(game) {
      if (get().migrationStatus) return;
      await get().initialize();
      preferences.selectedGame = game;
      persist();
      const token = ++selection;
      set({ game, ready: false, dataset: emptyDataset(),
        filter: pageFilter(pages[game], { ...structuredClone(EMPTY_FILTER),
          ...(preferences.games[game].pageFilters?.[filterScope(pages[game])] ?? preferences.games[game].filter) }),
        favorites: preferences.games[game].favorites, page: pages[game], error: null });
      publishSync(game);
      try {
        await withEngine(game, async () => {
          if (token !== selection) return;
          const snapshot = await platform.openDataset(game);
          await analysisClient(game).call({ op: "open", game, snapshot });
          if (token === selection) publishDataset(game, snapshot);
        });
      } catch (error) { if (token === selection) set({ error: message(error), ready: false }); }
    },
    navigate(page) {
      const game = get().game;
      const saved = preferences.games[game];
      if (!get().migrationStatus) saved.pageFilters = { ...saved.pageFilters, [filterScope(get().page)]: get().filter };
      if (page !== "home") pages[game] = page;
      const filter = pageFilter(page, { ...structuredClone(EMPTY_FILTER), ...(saved.pageFilters?.[filterScope(page)] ?? {}) });
      set({ page, filter });
      if (!get().migrationStatus) persist();
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
      if (get().migrationStatus) return;
      const filter = pageFilter(get().page, { ...get().filter, ...patch });
      const saved = preferences.games[get().game];
      saved.filter = filter;
      saved.pageFilters = { ...saved.pageFilters, [filterScope(get().page)]: filter };
      set({ filter });
      persist();
    },
    resetFilter() { get().setFilter(structuredClone(EMPTY_FILTER)); },
    toggleFavorite(id) {
      if (get().migrationStatus || get().busy) return;
      const favorites = get().favorites.includes(id) ? get().favorites.filter((f) => f !== id) : [...get().favorites, id];
      preferences.games[get().game].favorites = favorites;
      set({ favorites });
      persist();
    },
    setSettings(patch) {
      if (get().migrationStatus) return;
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
    async restoreArchive(source) {
      const game = get().game;
      await operation(game, async () => {
        const previous = await currentDataset(game);
        const checkpoint = loaded[game]!;
        const candidate = await platform.loadSourceDataset(game, source);
        if (!candidate) throw new Error("未找到来源归档");
        const dataset = await analysisClient(game).call<Dataset>({ op: "validateDataset", game, dataset: candidate });
        await analysisClient(game).call({ op: "load", game, ...dataset });
        let snapshot: DatasetSnapshot;
        try { snapshot = await platform.activateArchive(game, source, checkpoint.identity); }
        catch (error) {
          await analysisClient(game).call({ op: "load", game, ...previous });
          await analysisClient(game).call({ op: "open", game, snapshot: checkpoint, keepLoaded: true });
          throw error;
        }
        stopSource(game);
        await analysisClient(game).call({ op: "open", game, snapshot, keepLoaded: true });
        publishDataset(game, snapshot);
      });
    },
    async migrateLegacy(legacy, ids, active, usePreferences) {
      const game = get().game;
      let completed = false;
      await operation(game, async () => {
        set({ migrationStatus: "正在准备迁移" });
        try {
          const sources = ids.map((id) => legacy.sources.find((source) => source.id === id));
          if (sources.some((source) => !source) || new Set(ids).size !== ids.length) throw new Error("迁移来源选择无效");
          const mappings: Partial<Record<GameVersion, Record<string, string[]>>> = {};
          const activate = { ...active };
          for (const [index, source] of sources.entries()) {
            if (!source) continue;
            set({ migrationStatus: `正在校验和暂存 ${index + 1} / ${sources.length}` });
            const payload = await platform.readLegacySource(legacy.token, source.id);
            const current = await platform.openDataset(source.game);
            const previous = current.dataset.source === source.source
              ? await currentDataset(source.game)
              : await platform.loadSourceDataset(source.game, source.source) ?? emptyDataset();
            const prepared = await analysisClient(source.game).call<{ serialized: string; idMap: Record<string, string> }>({
              op: "prepareLegacyDataset", payload, previous, game: source.game,
            });
            await platform.stageLegacySource(legacy.token, source.id, prepared.serialized);
            const map = mappings[source.game] ??= {};
            for (const [oldID, newID] of Object.entries(prepared.idMap)) map[oldID] = [...new Set([...(map[oldID] ?? []), newID])];
            if (loaded[source.game]?.dataset.source === source.source && !activate[source.game]) activate[source.game] = source.id;
          }
          await persistQueue.catch(() => {});
          const next = usePreferences && legacy.preferences
            ? await analysisClient(game).call<Preferences>({ op: "legacyPreferences", current: preferences, values: legacy.preferences, mappings })
            : structuredClone(preferences);
          const changedGames = (["sts1", "sts2"] as const).filter((target) => !!activate[target]);
          for (const target of changedGames) {
            const source = legacy.sources.find((source) => source.id === activate[target]);
            if (!source || source.game !== target || !ids.includes(source.id)) throw new Error("迁移后的来源选择无效");
            if (loaded[target]?.dataset.source !== source.source) {
              next.games[target].source = "";
              next.games[target].autoSync = false;
            }
          }
          set({ migrationStatus: "正在提交全部来源与偏好" });
          await platform.commitLegacyMigration(legacy.token, ids, activate, next);
          preferences = cleanPreferences(next);
          set((state) => ({ archiveRevision: state.archiveRevision + 1 }));
          completed = true;
          for (const target of ["sts1", "sts2"] as const) {
            generations[target] += 1;
            syncStates[target] = { verifiedAt: 0, error: null, status: preferences.games[target].source
              ? preferences.games[target].autoSync ? "等待同步" : "已暂停" : "未选择同步文件夹", pending: false };
          }
          const saved = preferences.games[get().game];
          set({ favorites: saved.favorites, settings: { theme: preferences.theme, minimumSample: preferences.minimumSample,
            autoSync: saved.autoSync ?? preferences.autoSync }, filter: pageFilter(get().page,
            { ...structuredClone(EMPTY_FILTER), ...(saved.pageFilters?.[filterScope(get().page)] ?? get().filter) }),
            ready: changedGames.includes(get().game) ? false : get().ready });
          publishSync(get().game);
          for (const target of changedGames) {
            delete loaded[target];
            const snapshot = await platform.openDataset(target);
            await analysisClient(target).call({ op: "open", game: target, snapshot });
            publishDataset(target, snapshot);
          }
        } finally { set({ migrationStatus: null }); }
      });
      return completed;
    },
    async clearData() {
      const game = get().game;
      await get().setAccountSync({ ...get().accountSync, enabled: false });
      stopSource(game);
      // Stop the subscription first, then let an atomic write finish before deleting.
      while (activeOperation) await activeOperation.catch(() => {});
      stopSource(game);
      await operation(game, async () => {
        const dataset = emptyDataset();
        // Publish an empty checkpoint first, matching the native clear operation.
        // A later archive-cleanup error cannot leave the UI displaying deleted runs.
        await commit(game, dataset, await currentDataset(game));
        await platform.clearDataset(game);
        const snapshot = await platform.openDataset(game);
        await analysisClient(game).call({ op: "open", game, snapshot });
        publishDataset(game, snapshot);
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
