import { describe, expect, it } from "vitest";
import { BrowserFiles, manualDirectory, type ReadFolder } from "../src/services/browser/files";

function file(path: string, text = "{}"): File {
  const result = new File([text], path.split("/").at(-1)!, { lastModified: 100 });
  Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result;
}
describe("browser directory import", () => {
  it("follows the current Profile, skips hidden saves and keeps source directories read-only", async () => {
    const files = [file("account/profile.save", '{"last_profile_id":2}'), file("account/profile1/saves/old.run"),
      file("account/profile2/saves/new.run"), file("account/profile2/saves/.hidden.run")];
    const result = await manualDirectory(files);
    expect(result?.directory).toBe("");
    expect(result?.source).toContain("/profile2/saves");
    expect(result?.files.map((file) => file.name)).toEqual(["new.run"]);
    expect(await files[0].text()).toBe('{"last_profile_id":2}');
  });
  it("rejects ambiguous sources and traversal in profile configuration", async () => {
    await expect(manualDirectory([file("account/profile1/saves/a.run"), file("account/profile2/saves/b.run")])).rejects.toThrow("多个存档来源");
    await expect(manualDirectory([file("account/profile.save", '{"last_profile_id":"../outside"}')])).rejects.toThrow("Profile 无效");
    await expect(manualDirectory([file("saves/a/progress.save"), file("saves/b/progress.save")])).rejects.toThrow("多个 progress.save");
  });
  it("does not merge unrelated directories that have the same display name", async () => {
    const first = await manualDirectory([file("saves/a.run")]);
    const second = await manualDirectory([file("saves/a.run")]);
    expect(first?.source).not.toBe(second?.source);
  });
  it("restores stored read-only handles and requests renewed permission only on demand", async () => {
    const value = new File(["synthetic"], "one.run", { lastModified: 100 });
    let permission: PermissionState = "granted";
    const permissions: unknown[] = [];
    const folder: ReadFolder = { kind: "directory", name: "saves",
      async *values() { yield { kind: "file", name: value.name, getFile: async () => value }; },
      async getFileHandle() { throw new DOMException("Missing file", "NotFoundError"); },
      async getDirectoryHandle() { throw new DOMException("Missing directory", "NotFoundError"); },
      queryPermission: async () => permission,
      requestPermission: async (options) => { permissions.push(options); permission = "granted"; return permission; },
    };
    const entries = new Map<string, unknown>();
    const database = { async directories<T>() { return [...entries].map(([id, handle]) => ({ id, handle: handle as T })); },
      async directory<T>(id: string) { return entries.has(id) ? { id, handle: entries.get(id) as T } : undefined; },
      async saveDirectory<T>(id: string, handle: T) { entries.set(id, handle); } };
    const id = await new BrowserFiles(database).register(folder);
    const restarted = new BrowserFiles(database);
    expect(await restarted.resolve(id)).toBe(id);
    permission = "prompt";
    await expect(restarted.scan(id)).rejects.toThrow("读取权限已失效");
    expect(permissions).toEqual([]);
    expect(await restarted.requestAccess(id)).toBe(true);
    expect(permissions).toEqual([{ mode: "read" }]);
    expect((await restarted.scan(id))[0].text).toBe("synthetic");
    expect(await value.text()).toBe("synthetic");
  });
});
