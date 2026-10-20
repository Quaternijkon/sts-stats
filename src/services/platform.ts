import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Dataset, SaveFile, ImportSelection, Preferences, StatsPlatform,
  ArchiveSummary, DatasetSnapshot, LegacySelection, LegacySourceData } from "./models";
import { ENGINE_VERSION } from "./cacheVersion";
import { createBrowserPlatform } from "./browser";
export { stageBrowserDrop } from "./browser";
export { PREFERENCE_JOURNAL } from "./browser/preferences";

declare const __STATS_WEB_BUILD__: boolean;
export const isDesktop = !(typeof __STATS_WEB_BUILD__ === "boolean" && __STATS_WEB_BUILD__) && isTauri();
export const platformCapabilities = {
  desktop: isDesktop,
  directorySync: isDesktop || typeof window !== "undefined" && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === "function" && window.isSecureContext,
  legacyMigration: isDesktop,
  persistentStorage: !isDesktop && typeof navigator !== "undefined" && typeof navigator.storage?.persist === "function",
};
export function sourceLabel(source: string) {
  const match = /^web-(?:directory|files):[^:]+:([^/]*)(.*)$/.exec(source);
  if (!match) return source;
  try { return decodeURIComponent(match[1]) + match[2]; } catch { return source; }
}
const native: StatsPlatform = {
  async requestSourceAccess() { return true; },
  async storageInfo() { return { usage: null, quota: null, persistent: null }; },
  async requestPersistence() { return false; },
  takeDroppedSources: () =>
    invoke<ImportSelection | null>("take_dropped_sources"),
  chooseDirectory: () => invoke<ImportSelection | null>("choose_directory"),
  chooseFiles: () => invoke<SaveFile[]>("choose_files"),
  scanDirectory: (directory) =>
    invoke<SaveFile[]>("scan_directory", { directory }),
  resolveDirectory: (directory) => invoke<string>("resolve_directory", { directory }),
  snapshotDirectory: (directory) =>
    invoke<string>("snapshot_directory", { directory }),
  loadSourceDataset: (game, source) =>
    invoke<Dataset | null>("load_source_dataset", { game, source }),
  loadDataset: (game) => invoke<Dataset | null>("load_dataset", { game }),
  openDataset: (game) => invoke<DatasetSnapshot>("open_dataset", { game, engineVersion: ENGINE_VERSION }),
  loadDatasetText: (game, identity) => invoke<string | null>("load_dataset_text", { game, identity, engineVersion: ENGINE_VERSION }),
  readDerived: (game, identity, key) => invoke<string | null>("read_derived", { game, identity, key, engineVersion: ENGINE_VERSION }),
  writeDerived: (game, identity, key, text) => invoke("write_derived", { game, identity, key, text, engineVersion: ENGINE_VERSION }),
  saveDataset: (game, dataset, files, serialized) =>
    invoke<DatasetSnapshot>("save_dataset", {
      game,
      engineVersion: ENGINE_VERSION,
      text: serialized ?? JSON.stringify(dataset),
      files: files ?? [],
    }),
  importDataset: () => invoke<Dataset | null>("import_dataset"),
  listArchives: (game) => invoke<ArchiveSummary[]>("list_archives", { game }),
  activateArchive: (game, source) => invoke<DatasetSnapshot>("activate_archive", { game, source, engineVersion: ENGINE_VERSION }),
  chooseLegacyData: (includePreferences) => invoke<LegacySelection | null>("choose_legacy_data", { includePreferences }),
  readLegacySource: (token, id) => invoke<LegacySourceData>("read_legacy_source", { token, id }),
  stageLegacySource: (token, id, text) => invoke("stage_legacy_source", { token, id, text }),
  commitLegacyMigration: (token, ids, active, preferences) => invoke("commit_legacy_migration", { token, ids, active, preferences: JSON.stringify(preferences) }),
  cancelLegacyMigration: (token) => invoke("cancel_legacy_migration", { token }),
  exportText: (name, text) => invoke<boolean>("export_text", { name, text }),
  exportBinary: (name, data) => invoke<boolean>("export_binary", { name, data }),
  loadPreferences: () => invoke<Preferences | null>("load_preferences"),
  savePreferences: (preferences) =>
    invoke("save_preferences", { text: JSON.stringify(preferences) }),
  dataDirectory: () => invoke<string>("data_directory"),
  openDataDirectory: () => invoke("open_data_directory"),
  clearDataset: (game) => invoke("clear_dataset", { game }),
};
const adapter = isDesktop ? native : createBrowserPlatform();
export const platform: StatsPlatform = {
  ...adapter,
  async exportText(name, text) {
    try {
      return await adapter.exportText(name, text);
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent("sts2stats:error", { detail: String(error) }),
      );
      return false;
    }
  },
  async exportBinary(name, data) {
    try {
      return await adapter.exportBinary(name, data);
    } catch (error) {
      window.dispatchEvent(new CustomEvent("sts2stats:error", { detail: String(error) }));
      return false;
    }
  },
};
