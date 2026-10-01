import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDataset, prepareImport, prepareImportTransaction, validateDataset } from "../src/services/dataset";
import type { Dataset, GameVersion, ImportSelection, SaveFile } from "../src/services/models";

const mocks = vi.hoisted(() => ({
  platform: {
    loadPreferences: vi.fn(), savePreferences: vi.fn(), loadDataset: vi.fn(),
    loadSourceDataset: vi.fn(), saveDataset: vi.fn(), chooseDirectory: vi.fn(),
    chooseFiles: vi.fn(), takeDroppedSources: vi.fn(), importDataset: vi.fn(),
    snapshotDirectory: vi.fn(), resolveDirectory: vi.fn(), scanDirectory: vi.fn(),
    clearDataset: vi.fn(),
  },
  call: vi.fn(),
}));
vi.mock("../src/services/platform", () => ({ platform: mocks.platform }));
vi.mock("../src/worker/client", () => ({ analysisClient: (game: GameVersion) => ({
  call: (request: Record<string, unknown>) => mocks.call(game, request),
}) }));
const file = (start = 100): SaveFile => ({
  name: "synthetic.run", path: "/synthetic/synthetic.run", modifiedAt: start,
  text: JSON.stringify({ win: true, start_time: start, seed: "synthetic-seed", run_time: 600,
    players: [{ id: 1, character: "CHARACTER.IRONCLAD", deck: [], relics: [] }], map_point_history: [] }),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let engines: Partial<Record<GameVersion, Dataset>>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  engines = {};
  mocks.platform.loadPreferences.mockResolvedValue(null);
  mocks.platform.savePreferences.mockResolvedValue(undefined);
  mocks.platform.loadDataset.mockResolvedValue(null);
  mocks.platform.loadSourceDataset.mockResolvedValue(null);
  mocks.platform.saveDataset.mockResolvedValue(undefined);
  mocks.platform.snapshotDirectory.mockResolvedValue("stable");
  mocks.platform.resolveDirectory.mockResolvedValue("/synthetic");
  mocks.platform.scanDirectory.mockResolvedValue([file()]);
  mocks.call.mockImplementation(async (game: GameVersion, request: Record<string, unknown>) => {
    if (request.op === "validateDataset") return validateDataset(request.dataset, game);
    if (request.op === "prepareImport") return prepareImport(request.previous as Dataset, request.files as SaveFile[], request.source as string, game);
    if (request.op === "prepareImportTransaction") return prepareImportTransaction(request.previous as Dataset, request.files as SaveFile[], request.source as string, game, request.current as Dataset);
    if (request.op === "serializeDataset") return JSON.stringify(request.dataset);
    if (request.op === "load") {
      const { op: _op, game: _game, ...dataset } = request;
      engines[game] = structuredClone(dataset) as unknown as Dataset;
      return {};
    }
    throw new Error("Unexpected synthetic operation");
  });
});
describe("source and worker transactions", () => {
  it("keeps the game captured when a directory selector spans a game switch", async () => {
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    const selected = deferred<ImportSelection | null>();
    mocks.platform.chooseDirectory.mockReturnValue(selected.promise);
    const pending = useAppStore.getState().importDirectory();
    await useAppStore.getState().selectGame("sts1");
    selected.resolve({ directory: "/synthetic", files: [file()] });
    await pending;
    expect(mocks.platform.saveDataset).toHaveBeenCalledWith("sts2", expect.objectContaining({ source: "/synthetic" }), [file()], expect.any(String));
    expect(useAppStore.getState().game).toBe("sts1");
    expect(useAppStore.getState().dataset.runs).toHaveLength(0);
    await useAppStore.getState().selectGame("sts2");
    expect(useAppStore.getState().dataset.runs).toHaveLength(1);
  });
  it("serializes same-game reloads after an in-flight import", async () => {
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    const write = deferred<void>();
    mocks.platform.saveDataset.mockReturnValue(write.promise);
    const pending = useAppStore.getState().importFiles([file()], "/synthetic");
    await vi.waitFor(() => expect(mocks.platform.saveDataset).toHaveBeenCalled());
    const reload = useAppStore.getState().selectGame("sts2");
    write.resolve();
    await Promise.all([pending, reload]);
    expect(useAppStore.getState().dataset.runs).toHaveLength(1);
    expect(engines.sts2?.runs).toHaveLength(1);
  });
  it("restores the worker and visible dataset after a storage failure", async () => {
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    mocks.platform.saveDataset.mockRejectedValue(new Error("Synthetic full disk"));
    await useAppStore.getState().importFiles([file()], "/synthetic");
    expect(useAppStore.getState().dataset).toEqual(validateDataset(emptyDataset(), "sts2"));
    expect(engines.sts2?.runs).toHaveLength(0);
    expect(useAppStore.getState().error).toContain("Synthetic full disk");
  });
  it("retries a failed stable snapshot without replacing unrelated user errors", async () => {
    mocks.platform.loadPreferences.mockResolvedValue({ theme: "system", minimumSample: 1, autoSync: true,
      games: { sts1: { source: "", favorites: [] }, sts2: { source: "/synthetic", favorites: [], autoSync: true } } });
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    useAppStore.setState({ error: "An unrelated export failure" });
    mocks.platform.scanDirectory.mockRejectedValueOnce(new Error("Synthetic partial save"));
    await useAppStore.getState().sync(false);
    expect(mocks.platform.scanDirectory).not.toHaveBeenCalled();
    await useAppStore.getState().sync(false);
    expect(useAppStore.getState().syncError).toContain("Synthetic partial save");
    await useAppStore.getState().sync(false);
    expect(useAppStore.getState().syncError).toBeNull();
    expect(useAppStore.getState().dataset.runs).toHaveLength(1);
    expect(useAppStore.getState().error).toBe("An unrelated export failure");
  });
  it("restores a selected Profile archive even when its source files are gone", async () => {
    const archived = await prepareImport(emptyDataset(), [file()], "/synthetic/profile2/saves", "sts2");
    mocks.platform.loadSourceDataset.mockResolvedValue(archived);
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    await useAppStore.getState().importFiles([], "/synthetic/profile2/saves", "/synthetic");
    expect(useAppStore.getState().dataset.runs).toHaveLength(1);
    expect(useAppStore.getState().syncSource).toBe("/synthetic");
    expect(useAppStore.getState().dataset.source).toBe("/synthetic/profile2/saves");
  });
  it("inherits detail filters and restores every parent context on back navigation", async () => {
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    useAppStore.getState().setFilter({ dateFrom: "2026-01-01", characters: ["Silent"], ascensions: [10] });
    const context = structuredClone(useAppStore.getState().filter);
    useAppStore.getState().openRun("synthetic.run");
    expect(useAppStore.getState().filter).toEqual(context);
    useAppStore.getState().openObject("card", "SYNTHETIC_CARD");
    expect(useAppStore.getState().filter).toEqual(context);
    useAppStore.getState().setFilter({ ascensions: [15] });
    useAppStore.getState().back();
    expect(useAppStore.getState().page).toBe("run/synthetic.run");
    expect(useAppStore.getState().filter).toEqual(context);
    useAppStore.getState().back();
    expect(useAppStore.getState().page).toBe("dashboard");
    expect(useAppStore.getState().filter).toEqual(context);
    useAppStore.getState().navigate("runs");
    expect(useAppStore.getState().filter.characters).toEqual([]);
  });
  it("keeps a paused source paused when application focus triggers syncAll", async () => {
    mocks.platform.loadPreferences.mockResolvedValue({ theme: "system", minimumSample: 100_000, autoSync: true,
      games: { sts1: { source: "", favorites: [] }, sts2: { source: "/synthetic", favorites: [], autoSync: false } } });
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    await useAppStore.getState().syncAll(true);
    expect(mocks.platform.snapshotDirectory).not.toHaveBeenCalled();
    expect(useAppStore.getState().settings.minimumSample).toBe(1000);
    expect(useAppStore.getState().syncStatus).toBe("已暂停");
    await useAppStore.getState().sync();
    expect(mocks.platform.scanDirectory).toHaveBeenCalledOnce();
  });
  it("queues a manual sync requested during an automatic metadata poll", async () => {
    mocks.platform.loadPreferences.mockResolvedValue({ theme: "system", minimumSample: 1, autoSync: true,
      games: { sts1: { source: "", favorites: [] }, sts2: { source: "/synthetic", favorites: [], autoSync: true } } });
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    const snapshot = deferred<string>();
    mocks.platform.snapshotDirectory.mockReturnValueOnce(snapshot.promise);
    const polling = useAppStore.getState().sync(false);
    await useAppStore.getState().sync();
    snapshot.resolve("stable");
    await polling;
    await vi.waitFor(() => expect(mocks.platform.scanDirectory).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(useAppStore.getState().busy).toBe(false));
  });
  it("waits for an atomic import before clearing and retires a reinstalled source", async () => {
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    const write = deferred<void>();
    mocks.platform.saveDataset.mockReturnValueOnce(write.promise);
    const importing = useAppStore.getState().importFiles([file()], "/synthetic");
    await vi.waitFor(() => expect(mocks.platform.saveDataset).toHaveBeenCalled());
    const clearing = useAppStore.getState().clearData();
    expect(mocks.platform.clearDataset).not.toHaveBeenCalled();
    write.resolve();
    await Promise.all([importing, clearing]);
    expect(mocks.platform.clearDataset).toHaveBeenCalledWith("sts2");
    expect(useAppStore.getState().dataset.runs).toHaveLength(0);
    expect(useAppStore.getState().syncSource).toBe("");
    expect(engines.sts2?.runs).toHaveLength(0);
  });
  it("preserves a cancelled selector subscription but stops it after a rejected new selection", async () => {
    mocks.platform.loadPreferences.mockResolvedValue({ theme: "system", minimumSample: 1, autoSync: true,
      games: { sts1: { source: "", favorites: [] }, sts2: { source: "/synthetic", favorites: [], autoSync: true } } });
    const { useAppStore } = await import("../src/state/appStore");
    await useAppStore.getState().selectGame("sts2");
    mocks.platform.chooseDirectory.mockResolvedValueOnce(null);
    await useAppStore.getState().importDirectory();
    expect(useAppStore.getState().syncSource).toBe("/synthetic");
    mocks.platform.chooseDirectory.mockRejectedValueOnce(new Error("Synthetic inaccessible selected folder"));
    await useAppStore.getState().importDirectory();
    expect(useAppStore.getState().syncSource).toBe("");
    expect(useAppStore.getState().error).toContain("Synthetic inaccessible");
  });
});
