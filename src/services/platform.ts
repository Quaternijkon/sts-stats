import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Dataset,
  SaveFile,
  ImportSelection,
  Preferences,
  StatsPlatform,
  ArchiveSummary,
  DatasetSnapshot,
  LegacySelection,
  LegacySourceData,
} from "./models";
import { ENGINE_VERSION } from "./cacheVersion";
import { emptyDataset } from "./dataset";
import { datasetSummary } from "./summary";

async function browserSnapshot(game: "sts1" | "sts2"): Promise<DatasetSnapshot> {
  const text = localStorage.getItem("sts2stats.dataset." + game);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ENGINE_VERSION}|${text ?? "empty"}`));
  return {
    identity: Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    dataset: datasetSummary(text ? JSON.parse(text) : emptyDataset()),
  };
}
const derivedPrefix = "sts2stats.derived.";

function pickFiles(directory = false, json = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !json;
    input.accept = json ? ".json" : ".run,.save";
    if (directory) input.setAttribute("webkitdirectory", "");
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
async function saveFiles(files: File[]): Promise<SaveFile[]> {
  return Promise.all(
    files
      .filter(
        (f) =>
          f.name.toLowerCase().endsWith(".run") ||
          f.name.toLowerCase() === "progress.save",
      )
      .map(async (f) => ({
        name: f.name,
        path: f.webkitRelativePath || f.name,
        text: await f.text(),
        modifiedAt: f.lastModified,
      })),
  );
}
function download(name: string, blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.split(/[\\/]/).at(-1) || "export";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
/** Browser adapter supports isolated previews; installed apps use native storage. */
const browser: StatsPlatform = {
  async takeDroppedSources() {
    return null;
  },
  async chooseDirectory() {
    const files = await pickFiles(true);
    if (!files.length) return null;
    return {
      directory: files[0].webkitRelativePath.split("/")[0],
      files: await saveFiles(files),
    };
  },
  async chooseFiles() {
    return saveFiles(await pickFiles());
  },
  async scanDirectory() {
    throw new Error("浏览器预览需要重新选择文件夹；自动同步在桌面应用中可用");
  },
  async resolveDirectory(directory) {
    return directory;
  },
  async snapshotDirectory() {
    throw new Error("浏览器预览不支持自动同步");
  },
  async loadSourceDataset(game, source) {
    const value = localStorage.getItem(
      "sts2stats.archive." + game + "." + source,
    );
    return value ? JSON.parse(value) : null;
  },
  async loadDataset(game) {
    const value = localStorage.getItem("sts2stats.dataset." + game);
    return value ? JSON.parse(value) : null;
  },
  openDataset: browserSnapshot,
  async loadDatasetText(game, identity) {
    if ((await browserSnapshot(game)).identity !== identity) throw new Error("本地数据已更新，请重新打开当前游戏");
    return localStorage.getItem("sts2stats.dataset." + game);
  },
  async readDerived(game, identity, key) {
    if ((await browserSnapshot(game)).identity !== identity) return null;
    const path = `${derivedPrefix}${game}.${identity}.${key}`;
    const text = localStorage.getItem(path);
    if (!text) return null;
    const value = JSON.parse(text);
    localStorage.setItem(path, JSON.stringify({ ...value, accessed: Date.now() }));
    return typeof value.text === "string" ? value.text : null;
  },
  async writeDerived(game, identity, key, text) {
    if ((await browserSnapshot(game)).identity !== identity || text.length * 2 > 128 * 1024 * 1024) return;
    const path = `${derivedPrefix}${game}.${identity}.${key}`;
    localStorage.setItem(path, JSON.stringify({ text, accessed: Date.now() }));
    const entries = Object.keys(localStorage).filter((entry) => entry.startsWith(`${derivedPrefix}${game}.`))
      .map((entry) => ({ entry, text: localStorage.getItem(entry)! }));
    entries.sort((a, b) => JSON.parse(b.text).accessed - JSON.parse(a.text).accessed);
    let bytes = 0;
    entries.forEach((entry, index) => {
      bytes += entry.text.length * 2;
      if (index >= 128 || bytes > 128 * 1024 * 1024) localStorage.removeItem(entry.entry);
    });
  },
  async saveDataset(game, dataset, _files, serialized) {
    const text = serialized ?? JSON.stringify(dataset);
    const archiveKey = "sts2stats.archive." + game + "." + dataset.source;
    const previous = localStorage.getItem(archiveKey);
    localStorage.setItem(archiveKey, text);
    try {
      localStorage.setItem("sts2stats.dataset." + game, text);
    } catch (error) {
      if (previous === null) localStorage.removeItem(archiveKey);
      else localStorage.setItem(archiveKey, previous);
      throw error;
    }
    return browserSnapshot(game);
  },
  async importDataset() {
    const files = await pickFiles(false, true);
    return files.length ? JSON.parse(await files[0].text()) : null;
  },
  async listArchives(game) {
    return Object.keys(localStorage).filter((key) => key.startsWith("sts2stats.archive." + game + "."))
      .map((key): ArchiveSummary => {
        const dataset = JSON.parse(localStorage.getItem(key)!);
        return { source: dataset.source, runs: dataset.runs.length, importedAt: dataset.importedAt };
      });
  },
  async activateArchive(game, source) {
    const text = localStorage.getItem("sts2stats.archive." + game + "." + source);
    if (!text) throw new Error("未找到来源归档");
    localStorage.setItem("sts2stats.dataset." + game, text);
    return browserSnapshot(game);
  },
  async chooseLegacyData() { throw new Error("完整原应用迁移在桌面应用中可用；预览可导入 dataset.json"); },
  async readLegacySource() { throw new Error("浏览器预览不支持原生归档迁移"); },
  async stageLegacySource() { throw new Error("浏览器预览不支持原生归档迁移"); },
  async commitLegacyMigration() { throw new Error("浏览器预览不支持原生归档迁移"); },
  async cancelLegacyMigration() {},
  async exportText(name, text) {
    return download(name, new Blob([text], { type: "text/plain;charset=utf-8" }));
  },
  async exportBinary(name, data) {
    if (data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255))
      throw new Error("导出文件格式无效");
    return download(name, new Blob([new Uint8Array(data)]));
  },
  async loadPreferences() {
    const value = localStorage.getItem("sts2stats.preferences");
    return value ? JSON.parse(value) : null;
  },
  async savePreferences(value) {
    localStorage.setItem("sts2stats.preferences", JSON.stringify(value));
  },
  async dataDirectory() {
    return "浏览器本地存储";
  },
  async openDataDirectory() {
    throw new Error("浏览器预览使用浏览器本地存储，桌面应用可打开数据文件夹");
  },
  async clearDataset(game) {
    localStorage.removeItem("sts2stats.dataset." + game);
    for (const key of Object.keys(localStorage))
      if (key.startsWith("sts2stats.archive." + game + "."))
        localStorage.removeItem(key);
      else if (key.startsWith(`${derivedPrefix}${game}.`)) localStorage.removeItem(key);
  },
};
const native: StatsPlatform = {
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
const adapter = isTauri() ? native : browser;
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
