import type { DirectoryImportMode, ImportSelection, SaveFile } from "../models";
import type { BrowserDatabase } from "./database";

interface ReadFile { kind: "file"; name: string; getFile(): Promise<File> }
export interface ReadFolder {
  kind: "directory"; name: string;
  values(): AsyncIterableIterator<ReadFolder | ReadFile>;
  getFileHandle(name: string): Promise<ReadFile>;
  getDirectoryHandle(name: string): Promise<ReadFolder>;
  isSameEntry?(other: ReadFolder): Promise<boolean>;
  queryPermission?(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" }): Promise<PermissionState>;
}
type DirectoryWindow = Window & { showDirectoryPicker?: (options: { mode: "read"; id: string }) => Promise<ReadFolder> };
const savedFile = (name: string) => /\.run$/i.test(name) || name.toLowerCase() === "progress.save";
const missing = (error: unknown) => error instanceof DOMException && ["NotFoundError", "TypeMismatchError"].includes(error.name);
const sourceID = (kind: string, name: string) => `web-${kind}:${crypto.randomUUID()}:${encodeURIComponent(name)}`;

async function child<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch (error) { if (missing(error)) return null; throw error; }
}
export async function resolveFolder(root: ReadFolder, parts: string[] = []): Promise<{ folder: ReadFolder; parts: string[] }> {
  if (root.name === "saves" || await child(() => root.getFileHandle("progress.save"))) return { folder: root, parts };
  const profile = await child(() => root.getFileHandle("profile.save"));
  if (profile) {
    const file = await profile.getFile();
    if (file.size > 1024 * 1024) throw new Error("Profile 配置无效，请选择单一 Profile 的 saves 文件夹");
    const value = JSON.parse(await file.text()).last_profile_id;
    if (!(typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) throw new Error("当前 Profile 无效");
    const id = String(value);
    if (!id || id.length > 128 || /[/\\]/.test(id) || [".", ".."].includes(id)) throw new Error("当前 Profile 无效");
    const name = id.startsWith("profile") ? id : `profile${id}`;
    return { folder: await (await root.getDirectoryHandle(name)).getDirectoryHandle("saves"), parts: [...parts, name, "saves"] };
  }
  const folders: ReadFolder[] = [];
  for await (const entry of root.values()) if (entry.kind === "directory" && !entry.name.startsWith(".")) folders.push(entry);
  const accounts: ReadFolder[] = [];
  for (const folder of folders) if (await child(() => folder.getFileHandle("profile.save"))) accounts.push(folder);
  if (accounts.length > 1) throw new Error("发现多个账号或 Profile，请选择单一来源");
  if (accounts[0]) return resolveFolder(accounts[0], [...parts, accounts[0].name]);
  const saves: { folder: ReadFolder; parts: string[] }[] = [];
  for (const folder of folders) {
    if (folder.name === "saves") saves.push({ folder, parts: [...parts, folder.name] });
    else {
      const nested = await child(() => folder.getDirectoryHandle("saves"));
      if (nested) saves.push({ folder: nested, parts: [...parts, folder.name, "saves"] });
    }
  }
  if (saves.length > 1) throw new Error("发现多个存档来源，请选择单一 Profile 的 saves 文件夹");
  return saves[0] ?? { folder: root, parts };
}
async function listFiles(folder: ReadFolder, prefix = ""): Promise<{ path: string; file: File }[]> {
  const files: { path: string; file: File }[] = [];
  for await (const entry of folder.values()) {
    if (entry.name.startsWith(".")) continue;
    const path = prefix + entry.name;
    if (entry.kind === "directory") { for (const value of await listFiles(entry, path + "/")) files.push(value); }
    else if (savedFile(entry.name)) files.push({ path, file: await entry.getFile() });
  }
  if (files.filter(({ file }) => file.name.toLowerCase() === "progress.save").length > 1) throw new Error("发现多个 progress.save，请选择单一账号或 Profile 的存档文件夹");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function contents(files: { path: string; file: File }[], prefix: string): Promise<SaveFile[]> {
  const result: SaveFile[] = [];
  for (const { file, path } of files) result.push({ name: file.name, path: `${prefix}/${path}`, text: await file.text(), modifiedAt: file.lastModified });
  return result;
}
export function pickFiles(directory = false, json = false): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = !json; input.hidden = true;
    if (directory) {
      if (!("webkitdirectory" in input)) {
        reject(new Error("当前浏览器不支持文件夹选择，请使用最新版 Chrome、Edge 或 Safari"));
        return;
      }
      input.webkitdirectory = true;
      input.setAttribute("directory", "");
    } else input.accept = json ? ".json" : ".run,.save";
    const finish = (files: File[]) => { input.remove(); resolve(files); };
    input.onchange = () => finish(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => finish([]), { once: true });
    document.body.append(input); input.click();
  });
}
function virtualFolder(name: string, files: { path: string; file: File }[]): ReadFolder {
  const entries = new Map<string, ReadFolder | ReadFile>();
  const nested = new Map<string, { path: string; file: File }[]>();
  for (const value of files) {
    const [first, ...tail] = value.path.split("/");
    if (!first || first === "." || first === "..") throw new Error("文件路径无效");
    if (!tail.length) {
      if (entries.has(first) || nested.has(first)) throw new Error("存在同名文件，请分别导入不同来源");
      entries.set(first, { kind: "file", name: first, getFile: async () => value.file });
    }
    else {
      if (entries.has(first)) throw new Error("文件与文件夹重名，请分别导入不同来源");
      const group = nested.get(first) ?? [];
      group.push({ ...value, path: tail.join("/") }); nested.set(first, group);
    }
  }
  for (const [child, values] of nested) entries.set(child, virtualFolder(child, values));
  return { kind: "directory", name,
    async *values() { yield* entries.values(); },
    async getFileHandle(name) { const value = entries.get(name); if (value?.kind === "file") return value; throw new DOMException("Missing file", "NotFoundError"); },
    async getDirectoryHandle(name) { const value = entries.get(name); if (value?.kind === "directory") return value; throw new DOMException("Missing directory", "NotFoundError"); },
  };
}
export async function manualDirectory(files: File[]): Promise<ImportSelection | null> {
  if (!files.length) return null;
  const name = files[0].webkitRelativePath?.split("/")[0] || "导入文件";
  const root = virtualFolder(name, files.map((file) => ({ file, path: file.webkitRelativePath?.split("/").slice(1).join("/") || file.name })));
  const resolved = await resolveFolder(root);
  const source = sourceID("files", name) + (resolved.parts.length ? "/" + resolved.parts.join("/") : "");
  return { directory: "", source, files: await contents(await listFiles(resolved.folder), source) };
}
export class BrowserFiles {
  private dropped: Promise<ImportSelection | null> | null = null;
  private handles = new Map<string, ReadFolder>();
  constructor(private database: Pick<BrowserDatabase, "directories" | "directory" | "saveDirectory">) {}
  private remember(id: string, handle: ReadFolder) {
    this.handles.delete(id); this.handles.set(id, handle);
    while (this.handles.size > 64) this.handles.delete(this.handles.keys().next().value!);
    return handle;
  }
  private async handle(id: string): Promise<ReadFolder> {
    const cached = this.handles.get(id);
    if (cached) return this.remember(id, cached);
    const record = await this.database.directory<ReadFolder>(id);
    if (!record) throw new Error("请重新选择并授权存档文件夹");
    return this.remember(id, record.handle);
  }
  async register(handle: ReadFolder): Promise<string> {
    const previous = await this.database.directories<ReadFolder>();
    for (const value of previous) {
      try { if (await handle.isSameEntry?.(value.handle)) { this.remember(value.id, handle); return value.id; } } catch { /* Removed handles cannot be reused. */ }
    }
    const id = sourceID("directory", handle.name);
    await this.database.saveDirectory(id, handle);
    this.remember(id, handle);
    return id;
  }
  private async authorized(id: string): Promise<ReadFolder> {
    const handle = await this.handle(id);
    if (handle.queryPermission && await handle.queryPermission({ mode: "read" }) !== "granted") throw new Error("目录读取权限已失效，请点击“重新授权目录”或重新选择文件夹");
    return handle;
  }
  async requestAccess(id: string) {
    const handle = await this.handle(id);
    // Start permission requests directly in the user gesture after the handle lookup.
    return handle.requestPermission ? await handle.requestPermission({ mode: "read" }) === "granted" : true;
  }
  async resolve(id: string) {
    const { parts } = await resolveFolder(await this.authorized(id));
    return id + (parts.length ? "/" + parts.join("/") : "");
  }
  async scan(id: string) {
    const { folder, parts } = await resolveFolder(await this.authorized(id));
    return contents(await listFiles(folder), id + (parts.length ? "/" + parts.join("/") : ""));
  }
  async fingerprint(id: string) {
    const { folder, parts } = await resolveFolder(await this.authorized(id));
    const files = await listFiles(folder);
    const value = JSON.stringify([parts, files.map(({ path, file }) => [path, file.size, file.lastModified])]);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async chooseDirectory(mode: DirectoryImportMode = "manual"): Promise<ImportSelection | null> {
    if (mode === "manual") return manualDirectory(await pickFiles(true));
    const picker = (window as DirectoryWindow).showDirectoryPicker;
    if (!picker) throw new Error("当前浏览器不支持目录授权，请使用“导入文件夹”读取整个文件夹");
    let handle: ReadFolder;
    try { handle = await picker.call(window, { mode: "read", id: "sts2stats-saves" }); }
    catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      if (error instanceof DOMException && ["SecurityError", "NotAllowedError"].includes(error.name))
        throw new Error("浏览器不允许持续授权此目录，请改用“导入文件夹”一次性读取整个文件夹");
      throw error;
    }
    let directory: string;
    try { directory = await this.register(handle); }
    catch (error) {
      if (error instanceof DOMException && error.name === "DataCloneError")
        throw new Error("浏览器无法保存此目录授权，请改用“导入文件夹”读取整个文件夹");
      throw error;
    }
    const before = await this.fingerprint(directory);
    const source = await this.resolve(directory);
    const files = await this.scan(directory);
    if (before !== await this.fingerprint(directory) || source !== await this.resolve(directory)) throw new Error("读取期间存档发生变化，请稍后重试");
    return { directory, source, files };
  }
  async chooseFiles() {
    const files = (await pickFiles()).filter((file) => savedFile(file.name));
    if (new Set(files.map((file) => file.name)).size !== files.length) throw new Error("存在同名文件，请分别导入不同来源");
    return contents(files.map((file) => ({ path: file.name, file })), sourceID("files", "导入文件"));
  }
  stageDrop(transfer: DataTransfer) {
    // Capture entries while the drop event still grants access.
    const entries = Array.from(transfer.items).map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
    const plain = Array.from(transfer.files);
    this.dropped = (async () => {
      const files: { path: string; file: File }[] = [];
      async function read(entry: FileSystemEntry, prefix: string) {
        if (entry.name.startsWith(".")) return;
        if (entry.isFile) files.push({ path: prefix + entry.name, file: await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)) });
        else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader();
          for (;;) {
            const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
            if (!batch.length) break;
            for (const child of batch) await read(child, prefix + entry.name + "/");
          }
        }
      }
      for (const entry of entries) await read(entry, "");
      if (!entries.length) for (const file of plain) files.push({ path: file.name, file });
      if (!files.length) return null;
      const root = virtualFolder("拖入文件", files);
      const resolved = await resolveFolder(root);
      const source = sourceID("files", entries.length === 1 && entries[0].isDirectory ? entries[0].name : "拖入文件");
      return { directory: "", source, files: await contents(await listFiles(resolved.folder), source) };
    })();
    void this.dropped.catch(() => {});
  }
  async takeDropped() { const value = this.dropped; this.dropped = null; return value ? await value : null; }
}
