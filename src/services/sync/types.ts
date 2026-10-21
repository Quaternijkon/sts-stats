import type { Dataset, GameVersion } from "../models";

export interface AccountUser { id: string; username: string }
export interface SyncCheckpoint { revision: number; fingerprint: string; updated: number }
export interface AccountSyncSettings {
  accountId?: string;
  enabled: boolean;
  games: Partial<Record<GameVersion, SyncCheckpoint>>;
}
export interface CloudPayload { schema: 1; game: GameVersion; dataset: Dataset; favorites: string[] }
export interface PreparedCloud { payload: string; fingerprint: string; datasetFingerprint: string; empty: boolean; runs: number }
export interface CloudVault extends SyncCheckpoint { payload: string }
export interface AccountResponse { status: number; body: string }
