import type { ArchiveSummary, Dataset, DatasetSnapshot, DatasetSummary, GameVersion, Preferences } from "../models";
import { ENGINE_VERSION } from "../cacheVersion";
import { emptyDataset } from "../dataset";
import { datasetSummary } from "../summary";

const names = ["data", "snapshots", "archives", "archiveMeta", "preferences", "directories", "derived", "derivedMeta"];
const CACHE_BYTES = 128 * 1024 * 1024;
const CACHE_ENTRIES = 128;
type Stored = { revision: string; dataset: DatasetSummary; text: string };
type Meta = Omit<Stored, "text">;
type CacheMeta = { game: GameVersion; id: string; key: string; bytes: number; accessed: number };
type LegacyStorage = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("浏览器存储读取失败"));
  });
}
function snapshot(meta?: Meta): DatasetSnapshot {
  return { identity: `${ENGINE_VERSION}:${meta?.revision ?? "empty"}`,
    dataset: meta?.dataset ?? datasetSummary(emptyDataset()) };
}
function quota(error: unknown) { return error instanceof Error && error.name === "QuotaExceededError"; }

/** Text and startup metadata are separate so opening a game never reads all raw saves. */
export class BrowserDatabase {
  private connection: Promise<IDBDatabase> | null = null;
  constructor(private name = "sts2stats-web", private factory: () => IDBFactory = () => globalThis.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      if (!this.factory()) { reject(new Error("此浏览器无法使用本地存储，请检查浏览器权限或使用桌面版")); return; }
      const opening = this.factory().open(this.name, 1);
      let settled = false;
      opening.onupgradeneeded = () => {
        for (const name of names) opening.result.createObjectStore(name);
        opening.transaction!.objectStore("derivedMeta").createIndex("game", "game");
      };
      opening.onsuccess = () => {
        if (settled) { opening.result.close(); return; }
        settled = true;
        opening.result.onversionchange = () => { opening.result.close(); this.connection = null; };
        resolve(opening.result);
      };
      opening.onerror = () => { settled = true; this.connection = null; reject(opening.error); };
      opening.onblocked = () => { settled = true; this.connection = null; reject(new Error("请关闭其他旧版本标签页，再重新打开应用")); };
    });
    return this.connection;
  }
  private async transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    const tx = (await this.open()).transaction(stores, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("浏览器存储事务未提交"));
      tx.onerror = () => { /* onabort reports the transaction outcome. */ };
    });
    void finished.catch(() => {});
    try { const result = await action(tx); await finished; return result; }
    catch (error) {
      try { tx.abort(); } catch { /* A failed transaction may already be closed. */ }
      await finished.catch(() => {});
      throw error;
    }
  }
  async close() { (await this.connection)?.close(); this.connection = null; }
  async openDataset(game: GameVersion) {
    return this.transaction(["snapshots"], "readonly", async (tx) => snapshot(await request<Meta | undefined>(tx.objectStore("snapshots").get(game))));
  }
  async loadDatasetText(game: GameVersion, identity?: string): Promise<string | null> {
    return this.transaction(["data", "snapshots"], "readonly", async (tx) => {
      const current = await request<Meta | undefined>(tx.objectStore("snapshots").get(game));
      if (identity && snapshot(current).identity !== identity) throw new Error("其他标签页已更新数据，请重新读取当前游戏");
      return (await request<Stored | undefined>(tx.objectStore("data").get(game)))?.text ?? null;
    });
  }
  private async authoritative<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (!quota(error)) throw error;
      await this.transaction(["derived", "derivedMeta"], "readwrite", (tx) => {
        tx.objectStore("derived").clear(); tx.objectStore("derivedMeta").clear();
      });
      try { return await action(); }
      catch (failure) {
        if (quota(failure)) throw new Error("浏览器存储空间不足，本次导入未提交；请导出备份并释放空间后重试");
        throw failure;
      }
    }
  }
  async saveDataset(game: GameVersion, dataset: Dataset, text: string, expectedIdentity?: string) {
    const value: Stored = { revision: crypto.randomUUID(), dataset: datasetSummary(dataset), text };
    return this.authoritative(() => this.transaction(["data", "snapshots", "archives", "archiveMeta"], "readwrite", async (tx) => {
      const current = await request<Meta | undefined>(tx.objectStore("snapshots").get(game));
      if (expectedIdentity && snapshot(current).identity !== expectedIdentity) throw new Error("其他标签页已更新数据，本次导入未提交，请重新读取后重试");
      tx.objectStore("data").put(value, game);
      tx.objectStore("snapshots").put({ revision: value.revision, dataset: value.dataset }, game);
      tx.objectStore("archives").put(value, [game, dataset.source]);
      tx.objectStore("archiveMeta").put({ source: dataset.source, runs: dataset.runs.length, importedAt: dataset.importedAt }, [game, dataset.source]);
      return snapshot(value);
    }));
  }
  async loadSourceText(game: GameVersion, source: string) {
    return this.transaction(["archives"], "readonly", async (tx) =>
      (await request<Stored | undefined>(tx.objectStore("archives").get([game, source])))?.text ?? null);
  }
  async listArchives(game: GameVersion): Promise<ArchiveSummary[]> {
    return this.transaction(["archiveMeta"], "readonly", async (tx) => {
      const rows = await request<ArchiveSummary[]>(tx.objectStore("archiveMeta").getAll(IDBKeyRange.bound([game, ""], [game, []])));
      return rows.sort((a, b) => b.importedAt - a.importedAt || a.source.localeCompare(b.source));
    });
  }
  async activateArchive(game: GameVersion, source: string, expectedIdentity?: string) {
    const revision = crypto.randomUUID();
    return this.authoritative(() => this.transaction(["archives", "data", "snapshots"], "readwrite", async (tx) => {
      if (expectedIdentity && snapshot(await request<Meta | undefined>(tx.objectStore("snapshots").get(game))).identity !== expectedIdentity) throw new Error("其他标签页已更新数据，请重新读取后切换归档");
      const archived = await request<Stored | undefined>(tx.objectStore("archives").get([game, source]));
      if (!archived) throw new Error("未找到来源归档");
      const value = { ...archived, revision };
      tx.objectStore("data").put(value, game);
      tx.objectStore("snapshots").put({ revision, dataset: value.dataset }, game);
      return snapshot(value);
    }));
  }
  async readDerived(game: GameVersion, identity: string, key: string) {
    return this.transaction(["snapshots", "derived", "derivedMeta"], "readwrite", async (tx) => {
      if (snapshot(await request<Meta | undefined>(tx.objectStore("snapshots").get(game))).identity !== identity) return null;
      const id = [game, identity, key];
      const meta = await request<CacheMeta | undefined>(tx.objectStore("derivedMeta").get(id));
      if (!meta) return null;
      tx.objectStore("derivedMeta").put({ ...meta, accessed: Date.now() }, id);
      return await request<string | undefined>(tx.objectStore("derived").get(id)) ?? null;
    });
  }
  async writeDerived(game: GameVersion, identity: string, key: string, text: string) {
    const bytes = text.length * 2;
    if (bytes > 4 * 1024 * 1024) return;
    await this.transaction(["snapshots", "derived", "derivedMeta"], "readwrite", async (tx) => {
      if (snapshot(await request<Meta | undefined>(tx.objectStore("snapshots").get(game))).identity !== identity) return;
      const data = tx.objectStore("derived"), meta = tx.objectStore("derivedMeta");
      const previous = await request<CacheMeta[]>(meta.index("game").getAll(game));
      const entries = previous.filter((entry) => entry.id !== identity || entry.key !== key);
      entries.unshift({ game, id: identity, key, bytes, accessed: Date.now() });
      entries.sort((a, b) => b.accessed - a.accessed);
      data.put(text, [game, identity, key]);
      meta.put(entries.find((entry) => entry.id === identity && entry.key === key)!, [game, identity, key]);
      let total = 0;
      entries.forEach((entry, index) => {
        total += entry.bytes;
        if (index >= CACHE_ENTRIES || total > CACHE_BYTES) {
          data.delete([game, entry.id, entry.key]); meta.delete([game, entry.id, entry.key]);
        }
      });
    });
  }
  async loadPreferences(): Promise<Preferences | null> {
    return this.transaction(["preferences"], "readonly", async (tx) => await request<Preferences | undefined>(tx.objectStore("preferences").get("value")) ?? null);
  }
  async savePreferences(value: Preferences) {
    await this.authoritative(() => this.transaction(["preferences"], "readwrite", (tx) => { tx.objectStore("preferences").put(value, "value"); }));
  }
  async directories<T>(): Promise<{ id: string; handle: T }[]> {
    return this.transaction(["directories"], "readonly", async (tx) => {
      const store = tx.objectStore("directories");
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request<T[]>(store.getAll())]);
      return values.map((handle, index) => ({ id: String(keys[index]), handle }));
    });
  }
  async saveDirectory<T>(id: string, value: T) { await this.transaction(["directories"], "readwrite", (tx) => { tx.objectStore("directories").put(value, id); }); }
  async directory<T>(id: string): Promise<{ id: string; handle: T } | undefined> {
    return this.transaction(["directories"], "readonly", async (tx) => {
      const handle = await request<T | undefined>(tx.objectStore("directories").get(id));
      return handle ? { id, handle } : undefined;
    });
  }
  async clearDataset(game: GameVersion) {
    await this.transaction(["data", "snapshots", "archives", "archiveMeta", "derived", "derivedMeta"], "readwrite", async (tx) => {
      tx.objectStore("data").delete(game); tx.objectStore("snapshots").delete(game);
      for (const name of ["archives", "archiveMeta", "derived", "derivedMeta"]) {
        const store = tx.objectStore(name);
        const keys = await request(store.getAllKeys(IDBKeyRange.bound([game, ""], [game, []])));
        keys.forEach((key) => store.delete(key));
      }
    });
  }
  async migrateLegacy(storage: LegacyStorage, decode?: (text: string, game: GameVersion) => Promise<Dataset>) {
    const entries: { key: string; game: GameVersion; active: boolean; value: Stored }[] = [];
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key);
    for (const key of keys) {
      const match = /^sts2stats\.(dataset|archive)\.(sts1|sts2)(?:\.|$)/.exec(key);
      if (!match) continue;
      const text = storage.getItem(key);
      if (!text) continue;
      const game = match[2] as GameVersion;
      const dataset = decode ? await decode(text, game) : JSON.parse(text) as Dataset;
      entries.push({ key, game: match[2] as GameVersion, active: match[1] === "dataset",
        value: { revision: crypto.randomUUID(), dataset: datasetSummary(dataset), text } });
    }
    const prefs = storage.getItem("sts2stats.preferences");
    const preferences = prefs ? JSON.parse(prefs) : null;
    if (!entries.length && !prefs) {
      keys.filter((key) => key.startsWith("sts2stats.derived.")).forEach((key) => storage.removeItem(key));
      return;
    }
    await this.authoritative(() => this.transaction(["data", "snapshots", "archives", "archiveMeta", "preferences"], "readwrite", async (tx) => {
      for (const entry of entries) {
        const { game, value, active } = entry;
        if (!await request(tx.objectStore("archives").getKey([game, value.dataset.source]))) {
          tx.objectStore("archives").put(value, [game, value.dataset.source]);
          tx.objectStore("archiveMeta").put({ source: value.dataset.source, runs: value.dataset.runs.length, importedAt: value.dataset.importedAt }, [game, value.dataset.source]);
        }
        if (active && !await request(tx.objectStore("snapshots").getKey(game))) {
          tx.objectStore("data").put(value, game);
          tx.objectStore("snapshots").put({ revision: value.revision, dataset: value.dataset }, game);
        }
      }
      if (preferences && !await request(tx.objectStore("preferences").getKey("value"))) tx.objectStore("preferences").put(preferences, "value");
    }));
    for (const { key } of entries) storage.removeItem(key);
    if (prefs) storage.removeItem("sts2stats.preferences");
    keys.filter((key) => key.startsWith("sts2stats.derived.")).forEach((key) => storage.removeItem(key));
  }
}
