import type { GameVersion } from "../../Engine/domain/game";
import type { AccountResponse, AccountSyncSettings } from "./sync/types";
import type {
  CareerProgress,
  NormalizedRunV2,
  FilterSpec,
} from "../../Engine/domain/types";
export type { GameVersion, CareerProgress, NormalizedRunV2, FilterSpec };
export type DirectoryImportMode = "manual" | "sync";

/** importedAt follows Foundation's seconds since 2001-01-01 for native compatibility. */
export interface Dataset {
  runs: NormalizedRunV2[];
  progress: CareerProgress | null;
  source: string;
  importedAt: number;
  manifest: Record<string, string>;
  fileRunIDs: Record<string, string>;
  importMetadata?: Record<
    string,
    { modifiedAt: number; digest: string; versions: string[] }
  >;
}
export type SummaryRun = Pick<NormalizedRunV2,
  "id" | "fileName" | "character" | "ascension" | "status" | "floor" | "runTime" |
  "startTime" | "playerCount" | "isMultiplayer" | "buildId" | "gameMode"
> & { players: Pick<NormalizedRunV2["players"][number], "id" | "character">[] };
export interface DatasetSummary {
  runs: SummaryRun[];
  progress: Pick<CareerProgress, "characterStats" | "totalPlaytime" | "recordedFields"> | null;
  source: string;
  importedAt: number;
}
export interface DatasetSnapshot {
  identity: string;
  dataset: DatasetSummary;
}
export interface ArchiveSummary {
  source: string;
  runs: number;
  importedAt: number;
}
export interface LegacySource extends ArchiveSummary {
  id: string;
  game: GameVersion;
  active: boolean;
  revisions: number;
}
export interface LegacySelection {
  token: string;
  sources: LegacySource[];
  preferences: Record<string, unknown> | null;
}
export interface LegacyEntry {
  id: string;
  name: string;
  importedAt: number;
  modified: number;
  blob: string;
  versions: string[];
  text: string;
}
export interface LegacySourceData {
  source: string;
  dataset: unknown | null;
  runs: LegacyEntry[];
  progress: LegacyEntry | null;
}
export interface SaveFile {
  name: string;
  path: string;
  text: string;
  modifiedAt: number;
}
export interface ImportSelection {
  directory: string;
  source?: string;
  files: SaveFile[];
}
export interface Preferences {
  accountSync?: AccountSyncSettings;
  selectedGame?: GameVersion;
  theme: "system" | "light" | "dark";
  minimumSample: number;
  autoSync: boolean;
  games: Record<
    GameVersion,
    {
      source: string;
      favorites: string[];
      autoSync?: boolean;
      lastSyncedAt?: number;
      filter?: Partial<FilterSpec>;
      pageFilters?: Record<string, Partial<FilterSpec>>;
      savedQueries?: unknown[];
      legacyAutoSync?: boolean;
    }
  >;
}
export interface StatsPlatform {
  accountRequest(method: string, route: string, body?: string, accountId?: string): Promise<AccountResponse>;
  takeDroppedSources(): Promise<ImportSelection | null>;
  chooseDirectory(mode?: DirectoryImportMode): Promise<ImportSelection | null>;
  chooseFiles(): Promise<SaveFile[]>;
  resolveDirectory(directory: string, game?: GameVersion): Promise<string>;
  scanDirectory(directory: string, game?: GameVersion): Promise<SaveFile[]>;
  snapshotDirectory(directory: string, game?: GameVersion): Promise<string>;
  loadSourceDataset(game: GameVersion, source: string): Promise<Dataset | null>;
  loadDataset(game: GameVersion): Promise<Dataset | null>;
  openDataset(game: GameVersion): Promise<DatasetSnapshot>;
  loadDatasetText(game: GameVersion, identity: string): Promise<string | null>;
  readDerived(game: GameVersion, identity: string, key: string): Promise<string | null>;
  writeDerived(game: GameVersion, identity: string, key: string, text: string): Promise<void>;
  saveDataset(
    game: GameVersion,
    dataset: Dataset,
    files?: SaveFile[],
    serialized?: string,
    expectedIdentity?: string,
  ): Promise<DatasetSnapshot>;
  importDataset(): Promise<Dataset | null>;
  listArchives(game: GameVersion): Promise<ArchiveSummary[]>;
  activateArchive(game: GameVersion, source: string, expectedIdentity?: string): Promise<DatasetSnapshot>;
  requestSourceAccess(directory: string): Promise<boolean>;
  storageInfo(): Promise<{ usage: number | null; quota: number | null; persistent: boolean | null }>;
  requestPersistence(): Promise<boolean>;
  chooseLegacyData(includePreferences: boolean): Promise<LegacySelection | null>;
  readLegacySource(token: string, id: string): Promise<LegacySourceData>;
  stageLegacySource(token: string, id: string, text: string): Promise<void>;
  commitLegacyMigration(token: string, ids: string[], active: Partial<Record<GameVersion, string>>, preferences: Preferences): Promise<void>;
  cancelLegacyMigration(token: string): Promise<void>;
  exportText(name: string, text: string): Promise<boolean>;
  exportBinary(name: string, data: number[]): Promise<boolean>;
  loadPreferences(): Promise<Preferences | null>;
  stagePreferences?(preferences: Preferences): string;
  savePreferences(preferences: Preferences, checkpoint?: string): Promise<void>;
  dataDirectory(): Promise<string>;
  openDataDirectory(): Promise<void>;
  clearDataset(game: GameVersion): Promise<void>;
}
