import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Dataset,
  SaveFile,
  ImportSelection,
  Preferences,
  StatsPlatform,
} from "./models";

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
  async saveDataset(game, dataset) {
    const text = JSON.stringify(dataset);
    localStorage.setItem(
      "sts2stats.archive." + game + "." + dataset.source,
      text,
    );
    localStorage.setItem("sts2stats.dataset." + game, text);
  },
  async importDataset() {
    const files = await pickFiles(false, true);
    return files.length ? JSON.parse(await files[0].text()) : null;
  },
  async exportText(name, text) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
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
  async clearDataset(game) {
    localStorage.removeItem("sts2stats.dataset." + game);
    for (const key of Object.keys(localStorage))
      if (key.startsWith("sts2stats.archive." + game + "."))
        localStorage.removeItem(key);
  },
};
const native: StatsPlatform = {
  takeDroppedSources: () =>
    invoke<ImportSelection | null>("take_dropped_sources"),
  chooseDirectory: () => invoke<ImportSelection | null>("choose_directory"),
  chooseFiles: () => invoke<SaveFile[]>("choose_files"),
  scanDirectory: (directory) =>
    invoke<SaveFile[]>("scan_directory", { directory }),
  snapshotDirectory: (directory) =>
    invoke<string>("snapshot_directory", { directory }),
  loadSourceDataset: (game, source) =>
    invoke<Dataset | null>("load_source_dataset", { game, source }),
  loadDataset: (game) => invoke<Dataset | null>("load_dataset", { game }),
  saveDataset: (game, dataset, files) =>
    invoke("save_dataset", {
      game,
      text: JSON.stringify(dataset),
      files: files ?? [],
    }),
  importDataset: () => invoke<Dataset | null>("import_dataset"),
  exportText: (name, text) => invoke<boolean>("export_text", { name, text }),
  loadPreferences: () => invoke<Preferences | null>("load_preferences"),
  savePreferences: (preferences) =>
    invoke("save_preferences", { text: JSON.stringify(preferences) }),
  dataDirectory: () => invoke<string>("data_directory"),
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
};
