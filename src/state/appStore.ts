import { create } from "zustand";
import { EMPTY_FILTER } from "../../Engine/domain/schemas";
import { setCurrentGame, setGameCharacters } from "../../Engine/domain/game";
import type { ObjectKind } from "../../Engine/domain/objectTypes";
import { analysisClient } from "../worker/client";
import { platform } from "../services/platform";
import { emptyDataset } from "../services/dataset";
import type {
  Dataset,
  GameVersion,
  FilterSpec,
  Preferences,
  SaveFile,
} from "../services/models";

const defaults: Preferences = {
  theme: "system",
  minimumSample: 1,
  autoSync: true,
  games: {
    sts1: { source: "", favorites: [] },
    sts2: { source: "", favorites: [] },
  },
};
let preferences = structuredClone(defaults);
let persistQueue = Promise.resolve();
let selection = 0;
let initialization: Promise<void> | null = null;
const pages: Record<GameVersion, string> = {
  sts1: "dashboard",
  sts2: "dashboard",
};
const snapshots: Partial<Record<GameVersion, string>> = {};
const backStacks: Record<GameVersion, string[]> = { sts1: [], sts2: [] };
function filterScope(page: string): string {
  if (page.startsWith("object/")) return "objects/" + page.split("/")[1];
  if (page.startsWith("run/")) return "runs";
  return page;
}
function persist() {
  const snapshot = structuredClone(preferences);
  persistQueue = persistQueue
    .catch(() => {})
    .then(() => platform.savePreferences(snapshot));
  persistQueue.catch((error) => useAppStore.setState({ error: String(error) }));
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
  importFiles(files: SaveFile[], source: string): Promise<void>;
  importDirectory(): Promise<void>;
  importDropped(): Promise<void>;
  importSingleFiles(): Promise<void>;
  sync(): Promise<void>;
  importExistingDataset(): Promise<void>;
  clearData(): Promise<void>;
  dismissError(): void;
}
export const useAppStore = create<AppState>((set, get) => ({
  game: "sts2",
  page: "home",
  dataset: emptyDataset(),
  characters: ["Ironclad", "Silent", "Regent", "Necrobinder", "Defect"],
  filter: structuredClone(EMPTY_FILTER),
  revision: 0,
  ready: false,
  busy: false,
  error: null,
  favorites: [],
  settings: { theme: "system", minimumSample: 1, autoSync: true },
  async initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const saved = await platform.loadPreferences();
        if (saved)
          preferences = {
            ...defaults,
            ...saved,
            games: { ...defaults.games, ...saved.games },
          };
        set({
          settings: {
            theme: preferences.theme,
            minimumSample: preferences.minimumSample,
            autoSync: preferences.autoSync,
          },
        });
      } catch (error) {
        set({ error: String(error), ready: false });
      }
    })();
    return initialization;
  },
  async selectGame(game) {
    await get().initialize();
    const token = ++selection;
    set({
      game,
      ready: false,
      dataset: emptyDataset(),
      filter: {
        ...structuredClone(EMPTY_FILTER),
        ...(preferences.games[game].pageFilters?.[filterScope(pages[game])] ??
          preferences.games[game].filter),
      },
      favorites: preferences.games[game].favorites,
      page: pages[game],
      error: null,
    });
    try {
      const candidate = (await platform.loadDataset(game)) ?? emptyDataset();
      const dataset = await analysisClient(game).call<Dataset>({
        op: "validateDataset",
        game,
        dataset: candidate,
      });
      await analysisClient(game).call({ op: "load", game, ...dataset });
      if (token !== selection) return;
      setCurrentGame(game);
      const characters = [
        ...setGameCharacters([
          ...dataset.runs.flatMap((r) => [
            r.character,
            ...r.players.map((p) => p.character),
          ]),
          ...(dataset.progress?.characterStats ?? []).map((s) => s.character),
        ]),
      ];
      set((s) => ({
        dataset,
        characters,
        ready: true,
        revision: s.revision + 1,
      }));
    } catch (error) {
      if (token === selection) set({ error: String(error), ready: false });
    }
  },
  navigate(page) {
    const game = get().game;
    const saved = preferences.games[game];
    saved.pageFilters = {
      ...saved.pageFilters,
      [filterScope(get().page)]: get().filter,
    };
    if (page !== "home") pages[game] = page;
    const filter = {
      ...structuredClone(EMPTY_FILTER),
      ...(saved.pageFilters[filterScope(page)] ?? {}),
    };
    set({ page, filter });
    persist();
  },
  openRun(id) {
    backStacks[get().game].push(get().page);
    get().navigate("run/" + encodeURIComponent(id));
  },
  openObject(kind, id) {
    backStacks[get().game].push(get().page);
    get().navigate("object/" + kind + "/" + encodeURIComponent(id));
  },
  back() {
    const page = backStacks[get().game].pop();
    get().navigate(page ?? "dashboard");
  },
  setFilter(patch) {
    const filter = { ...get().filter, ...patch };
    preferences.games[get().game].filter = filter;
    set({ filter });
    preferences.games[get().game].pageFilters = {
      ...preferences.games[get().game].pageFilters,
      [filterScope(get().page)]: filter,
    };
    persist();
  },
  resetFilter() {
    get().setFilter(structuredClone(EMPTY_FILTER));
  },
  toggleFavorite(id) {
    const favorites = get().favorites.includes(id)
      ? get().favorites.filter((f) => f !== id)
      : [...get().favorites, id];
    preferences.games[get().game].favorites = favorites;
    set({ favorites });
    persist();
  },
  setSettings(patch) {
    Object.assign(preferences, patch);
    set({ settings: { ...get().settings, ...patch } });
    persist();
  },
  async importFiles(files, source) {
    if (get().busy) return;
    const game = get().game;
    let previous = get().dataset;
    set({ busy: true, error: null });
    try {
      if (previous.source && previous.source !== source) {
        const archived = await platform.loadSourceDataset(game, source);
        if (archived)
          previous = await analysisClient(game).call<Dataset>({
            op: "validateDataset",
            game,
            dataset: archived,
          });
      }
      const dataset = await analysisClient(game).call<Dataset>({
        op: "prepareImport",
        previous,
        files,
        source,
        game,
      });
      await platform.saveDataset(game, dataset, files);
      await analysisClient(game).call({ op: "load", game, ...dataset });
      preferences.games[game].source = source.includes("\n") ? "" : source;
      delete snapshots[game];
      persist();
      if (get().game === game) {
        setCurrentGame(game);
        const characters = [
          ...setGameCharacters([
            ...dataset.runs.flatMap((r) => [
              r.character,
              ...r.players.map((p) => p.character),
            ]),
            ...(dataset.progress?.characterStats ?? []).map((s) => s.character),
          ]),
        ];
        set((s) => ({
          dataset,
          characters,
          ready: true,
          revision: s.revision + 1,
        }));
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },
  async importDropped() {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const selected = await platform.takeDroppedSources();
      set({ busy: false });
      if (selected) {
        await get().importFiles(selected.files, selected.directory);
        if (!get().error && get().page === "home") get().navigate("dashboard");
      }
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  async importDirectory() {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const selected = await platform.chooseDirectory();
      set({ busy: false });
      if (selected) await get().importFiles(selected.files, selected.directory);
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  async importSingleFiles() {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const files = await platform.chooseFiles();
      set({ busy: false });
      if (files.length)
        await get().importFiles(
          files,
          "files:\n" +
            files
              .map((file) => file.path)
              .sort()
              .join("\n"),
        );
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  async sync() {
    const source = preferences.games[get().game].source;
    if (!source || get().busy) return;
    set({ busy: true, error: null });
    try {
      const game = get().game;
      const before = await platform.snapshotDirectory(source);
      if (snapshots[game] === before) return;
      const files = await platform.scanDirectory(source);
      const after = await platform.snapshotDirectory(source);
      if (before !== after)
        throw new Error(
          "\u5b58\u6863\u6b63\u5728\u5199\u5165\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5",
        );
      set({ busy: false });
      await get().importFiles(files, source);
      if (!get().error) snapshots[game] = after;
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  async importExistingDataset() {
    if (get().busy) return;
    const game = get().game;
    set({ busy: true, error: null });
    try {
      const imported = await platform.importDataset();
      if (!imported) return;
      const dataset = await analysisClient(game).call<Dataset>({
        op: "validateDataset",
        game,
        dataset: imported,
      });
      await platform.saveDataset(game, dataset);
      await get().selectGame(game);
      preferences.games[game].source = "";
      persist();
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  async clearData() {
    const game = get().game;
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      await platform.clearDataset(game);
      preferences.games[game] = { source: "", favorites: [] };
      persist();
      if (get().game === game) await get().selectGame(game);
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  dismissError() {
    set({ error: null });
  },
}));
