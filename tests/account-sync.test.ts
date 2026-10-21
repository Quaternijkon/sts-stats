import { describe, expect, it } from "vitest";
import { syncDecision } from "../src/services/sync/decision";
import { prepareCloud, parseCloud } from "../src/services/sync/payload";
import { emptyDataset } from "../src/services/dataset";
const base = { revision: 1, fingerprint: "a", updated: 1 };
describe("account synchronization decisions", () => {
  it("never overwrites independent edits or an older restored server checkpoint", () => {
    expect(syncDecision("local", false, base, { ...base, revision: 2, fingerprint: "remote" })).toBe("conflict");
    expect(syncDecision("local", false, undefined, base)).toBe("conflict");
    expect(syncDecision("local", false, { ...base, revision: 2 }, base)).toBe("conflict");
    expect(syncDecision("a", false, base, undefined)).toBe("conflict");
  });
  it("uploads local edits, downloads remote edits and initializes empty devices", () => {
    expect(syncDecision("local", false, base, base)).toBe("upload");
    expect(syncDecision("a", false, base, { ...base, revision: 2, fingerprint: "remote" })).toBe("download");
    expect(syncDecision("empty", true, undefined, base)).toBe("download");
    expect(syncDecision("a", false, undefined, undefined)).toBe("upload");
    expect(syncDecision("empty", true, undefined, undefined)).toBe("idle");
    expect(syncDecision("a", false, undefined, base)).toBe("equal");
  });
  it("omits directory paths and manifests, preserves Foundation dates and roundtrips stable fingerprints", async () => {
    const dataset = { ...emptyDataset(), source: "/synthetic/private/path", importedAt: 12345, manifest: { "/synthetic/a.run": "hash" }, fileRunIDs: {} };
    const result = await prepareCloud(dataset, ["b", "a", "b"], "sts2");
    expect(result.payload).not.toContain("/synthetic");
    const remote = await parseCloud(result.payload, "sts2");
    expect(remote.dataset.importedAt).toBe(12345);
    expect(remote.favorites).toEqual(["a", "b"]);
    expect(remote.fingerprint).toBe(result.fingerprint);
    expect((await prepareCloud({ ...dataset, source: "another-device" }, ["a", "b"], "sts2")).fingerprint).toBe(result.fingerprint);
    await expect(parseCloud(result.payload, "sts1")).rejects.toThrow();
  });
});
