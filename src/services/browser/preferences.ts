import type { Preferences } from "../models";

type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const PREFERENCE_JOURNAL = "sts2stats.pending-preferences.v1";
/** A small synchronous journal survives reload before the async IndexedDB write completes. */
export class PreferenceJournal {
  constructor(private storage: () => StorageAccess, private database: { savePreferences(value: Preferences): Promise<void> }) {}
  stage(preferences: Preferences) {
    const id = crypto.randomUUID();
    this.storage().setItem(PREFERENCE_JOURNAL, JSON.stringify({ id, preferences }));
    return id;
  }
  private read(): { id: string; preferences: Preferences } | null {
    const text = this.storage().getItem(PREFERENCE_JOURNAL);
    return text ? JSON.parse(text) : null;
  }
  private clear(id: string) {
    if (this.read()?.id === id) this.storage().removeItem(PREFERENCE_JOURNAL);
  }
  pending() { return this.read()?.preferences ?? null; }
  async save(value: Preferences, id?: string) {
    await this.database.savePreferences(value);
    if (id) this.clear(id);
  }
  async recover() {
    const value = this.read();
    if (value) await this.save(value.preferences, value.id);
  }
}
