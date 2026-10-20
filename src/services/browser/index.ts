import type { Dataset, GameVersion, StatsPlatform } from "../models";
import { BrowserDatabase } from "./database";
import { BrowserFiles, pickFiles } from "./files";
import { PreferenceJournal } from "./preferences";

let dropTarget: BrowserFiles | null = null;
export function stageBrowserDrop(transfer: DataTransfer) { dropTarget?.stageDrop(transfer); }
async function decodeDataset(text: string, game: GameVersion) {
  const { analysisClient } = await import("../../worker/client");
  return analysisClient(game).call<Dataset>({ op: "parseDataset", game, text });
}
function download(name: string, blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name.split(/[\\/]/).at(-1) || "export";
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export function createBrowserPlatform(): StatsPlatform {
  const database = new BrowserDatabase();
  const files = new BrowserFiles(database);
  const preferences = new PreferenceJournal(() => localStorage, database);
  dropTarget = files;
  const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sts2stats-web-data") : null;
  if (channel) channel.onmessage = ({ data }) => {
    if (data?.game === "sts1" || data?.game === "sts2") window.dispatchEvent(new CustomEvent("sts2stats:dataset-changed", { detail: data.game }));
  };
  let initialized: Promise<void> | null = null;
  const migrate = () => database.migrateLegacy(localStorage, decodeDataset);
  const ready = () => {
    if (!initialized) initialized = (async () => {
      if (typeof window !== "undefined" && !window.isSecureContext) throw new Error("Web 版需要通过 HTTPS 或 localhost 打开");
      await migrate();
      await preferences.recover();
    })().catch((error) => { initialized = null; throw error; });
    return initialized;
  };
  const changed = (game: GameVersion) => channel?.postMessage({ game });
  const verifySource = async (source: string, game?: GameVersion) => {
    if (!game) return;
    await ready();
    const current = preferences.pending() ?? await database.loadPreferences();
    if (current?.games[game]?.source !== source) throw new Error("其他标签页已更改同步来源，请重新读取当前游戏");
  };
  return {
    takeDroppedSources: () => files.takeDropped(),
    chooseDirectory: () => files.chooseDirectory(),
    chooseFiles: () => files.chooseFiles(),
    async resolveDirectory(source, game) { await verifySource(source, game); return files.resolve(source); },
    async scanDirectory(source, game) { await verifySource(source, game); return files.scan(source); },
    async snapshotDirectory(source, game) { await verifySource(source, game); return files.fingerprint(source); },
    requestSourceAccess: (source) => files.requestAccess(source),
    async loadSourceDataset(game, source) {
      await ready(); const text = await database.loadSourceText(game, source);
      return text ? decodeDataset(text, game) : null;
    },
    async loadDataset(game) {
      await ready(); const text = await database.loadDatasetText(game);
      return text ? decodeDataset(text, game) : null;
    },
    async openDataset(game) { await ready(); return database.openDataset(game); },
    async loadDatasetText(game, identity) { await ready(); return database.loadDatasetText(game, identity); },
    async readDerived(game, identity, key) { await ready(); return database.readDerived(game, identity, key); },
    async writeDerived(game, identity, key, text) { await ready(); await database.writeDerived(game, identity, key, text); },
    async saveDataset(game, dataset, _files, serialized, expectedIdentity) {
      await ready();
      const result = await database.saveDataset(game, dataset, serialized ?? JSON.stringify(dataset), expectedIdentity);
      changed(game); return result;
    },
    async importDataset() {
      const selected = await pickFiles(false, true);
      if (!selected.length) return null;
      const { analysisClient } = await import("../../worker/client");
      return analysisClient("sts2").call<Dataset>({ op: "parseJson", text: await selected[0].text() });
    },
    async listArchives(game) { await ready(); await migrate(); return database.listArchives(game); },
    async activateArchive(game, source, expectedIdentity) {
      await ready(); const result = await database.activateArchive(game, source, expectedIdentity);
      changed(game); return result;
    },
    async chooseLegacyData() { throw new Error("Web 版可导入 dataset.json；旧目录与 plist 完整迁移请使用桌面版"); },
    async readLegacySource() { throw new Error("完整旧应用迁移需要桌面版"); },
    async stageLegacySource() { throw new Error("完整旧应用迁移需要桌面版"); },
    async commitLegacyMigration() { throw new Error("完整旧应用迁移需要桌面版"); },
    async cancelLegacyMigration() {},
    async exportText(name, text) { return download(name, new Blob([text], { type: "text/plain;charset=utf-8" })); },
    async exportBinary(name, data) {
      if (data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error("导出文件格式无效");
      return download(name, new Blob([new Uint8Array(data)]));
    },
    stagePreferences: (value) => preferences.stage(value),
    async loadPreferences() { await ready(); return preferences.pending() ?? database.loadPreferences(); },
    async savePreferences(value, checkpoint) { await ready(); await preferences.save(value, checkpoint); },
    async dataDirectory() { return "当前站点的浏览器存储"; },
    async openDataDirectory() { throw new Error("浏览器数据由当前站点保存，可导出 dataset.json 备份"); },
    async storageInfo() {
      const info = await navigator.storage?.estimate?.();
      const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
      return { usage: info?.usage ?? null, quota: info?.quota ?? null, persistent };
    },
    async requestPersistence() { return navigator.storage?.persist ? navigator.storage.persist() : false; },
    async clearDataset(game) { await ready(); await database.clearDataset(game); changed(game); },
  };
}
