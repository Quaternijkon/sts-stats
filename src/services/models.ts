import type { GameVersion } from "../../Engine/domain/game";
import type {
  CareerProgress,
  NormalizedRunV2,
  FilterSpec,
} from "../../Engine/domain/types";
export type { GameVersion, CareerProgress, NormalizedRunV2, FilterSpec };

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
    }
  >;
}
export interface StatsPlatform {
  takeDroppedSources(): Promise<ImportSelection | null>;
  chooseDirectory(): Promise<ImportSelection | null>;
  chooseFiles(): Promise<SaveFile[]>;
  resolveDirectory(directory: string): Promise<string>;
  scanDirectory(directory: string): Promise<SaveFile[]>;
  snapshotDirectory(directory: string): Promise<string>;
  loadSourceDataset(game: GameVersion, source: string): Promise<Dataset | null>;
  loadDataset(game: GameVersion): Promise<Dataset | null>;
  saveDataset(
    game: GameVersion,
    dataset: Dataset,
    files?: SaveFile[],
    serialized?: string,
  ): Promise<void>;
  importDataset(): Promise<Dataset | null>;
  exportText(name: string, text: string): Promise<boolean>;
  exportBinary(name: string, data: number[]): Promise<boolean>;
  loadPreferences(): Promise<Preferences | null>;
  savePreferences(preferences: Preferences): Promise<void>;
  dataDirectory(): Promise<string>;
  openDataDirectory(): Promise<void>;
  clearDataset(game: GameVersion): Promise<void>;
}
