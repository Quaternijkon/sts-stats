import { describe, expect, it, vi } from "vitest";
import { PreferenceJournal, PREFERENCE_JOURNAL } from "../src/services/browser/preferences";
import type { Preferences } from "../src/services/models";

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, text: string) => { values.set(key, text); }, removeItem: (key: string) => { values.delete(key); } };
  const savePreferences = vi.fn(async (_value: Preferences) => {});
  return { values, storage, database: { savePreferences } };
}
const preferences: Preferences = { theme: "light", minimumSample: 1, autoSync: false,
  games: { sts1: { source: "", favorites: [] }, sts2: { source: "", favorites: ["synthetic.run"] } } };
describe("browser preference journal", () => {
  it("recovers the latest preference change after reload before IndexedDB finished", async () => {
    const { storage, database, values } = setup();
    const first = new PreferenceJournal(() => storage, database);
    first.stage(preferences);
    const latest = { ...preferences, theme: "dark" as const, minimumSample: 7 };
    first.stage(latest);
    expect(values.has(PREFERENCE_JOURNAL)).toBe(true);
    const restarted = new PreferenceJournal(() => storage, database);
    await restarted.recover();
    expect(database.savePreferences).toHaveBeenCalledExactlyOnceWith(latest);
    expect(values.has(PREFERENCE_JOURNAL)).toBe(false);
  });
  it("does not erase a newer journal when an older write completes", async () => {
    const { storage, database } = setup();
    const journal = new PreferenceJournal(() => storage, database);
    const previous = journal.stage(preferences);
    const latest = { ...preferences, minimumSample: 10 };
    const current = journal.stage(latest);
    await journal.save(preferences, previous);
    expect(journal.pending()).toEqual(latest);
    await journal.save(latest, current);
    expect(journal.pending()).toBeNull();
  });
});
