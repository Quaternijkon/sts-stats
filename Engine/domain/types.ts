export type RunStatus = 'win' | 'loss' | 'abandoned';
export type RunScope = 'history' | 'imported' | 'demo';
export type DataScope = 'personal';
export type DataItemKind =
  | 'card' | 'relic' | 'encounter' | 'ancient' | 'run'
  | 'character' | 'build' | 'ascension' | 'outcome' | 'party' | 'gameMode'
  | 'floor' | 'act' | 'date' | 'week' | 'playerPosition' | 'roomType'
  | 'potion' | 'event' | 'enemy' | 'enchantment' | 'quest' | 'restChoice'
  | 'badge' | 'epoch' | 'achievement' | 'location' | 'modifier';

export interface DataItemRef {
  kind: DataItemKind;
  id: string;
  label?: string;
}

export interface RunCapabilities {
  hasMap: boolean;
  hasPlayerTelemetry: boolean;
  hasCardChoices: boolean;
  hasRelicEvents: boolean;
  hasEncounterEvents: boolean;
  hasVersion: boolean;
}

export interface NormalizedCard {
  id: string;
  floorAdded: number;
  floorKnown?: boolean;
  upgradeLevel: number;
  upgradeKnown?: boolean;
}

export interface NormalizedRelic {
  id: string;
  floorAdded: number;
  floorKnown?: boolean;
}

export interface NormalizedPlayer {
  id: number;
  character: string;
  deck: NormalizedCard[];
  relics: NormalizedRelic[];
  potions: string[];
  badges: string[];
  maxPotionSlots: number;
}

export interface TimelineChoice { id: string; picked: boolean; upgradeLevel?: number }
export interface LocalizedChoiceTitle { table: string; key: string }

export interface TimelinePoint {
  floor: number;
  act: number;
  actFloor: number;
  type: string;
  label: string;
  hp: number;
  maxHp: number;
  gold: number;
  damageTaken: number;
  hpHealed: number;
  goldGained: number;
  goldSpent: number;
  recordedFields?: string[];
  turns?: number;
  ancientId?: string | null;
  cardsGained?: NormalizedCard[];
  cardsRemoved?: NormalizedCard[];
  cardsTransformed?: Array<{ from: NormalizedCard | null; to: NormalizedCard | null }>;
  upgradedCards?: string[];
  downgradedCards?: string[];
  enchantedCards?: Array<{ card: NormalizedCard | null; enchantment: string; amount?: number }>;
  cardChoices?: TimelineChoice[];
  relicChoices?: TimelineChoice[];
  potionChoices?: TimelineChoice[];
  boughtRelics?: string[];
  relicsRemoved?: string[];
  relicsGained?: string[];
  boughtColorless?: string[];
  potionsUsed?: string[];
  potionsBought?: string[];
  potionsDiscarded?: string[];
  potionsGained?: string[];
  eventChoices?: Array<{ title: LocalizedChoiceTitle; id?: string; chosen?: boolean }>;
  ancientChoices?: Array<{ relicId: string; title: LocalizedChoiceTitle; chosen: boolean }>;
  completedQuests?: string[];
  completedQuestDetails?: Array<{ id: string; cardId?: string }>;
  restChoices?: string[];
  [key: string]: unknown;
}

export interface NormalizedRunV2 {
  modelVersion: 2;
  parserVersion: string;
  sourceScope: RunScope;
  sourceKey: string;
  importedAt: number;
  capabilities: RunCapabilities;
  id: string;
  fileName: string;
  seed: string;
  buildId: string;
  gameMode: string;
  schemaVersion: number;
  platformType: string;
  players: NormalizedPlayer[];
  playerCount: number;
  isMultiplayer: boolean;
  character: string;
  ascension: number;
  win: boolean;
  status: RunStatus;
  floor: number;
  runTime: number;
  startTime: number;
  deckSize: number;
  deck: NormalizedCard[];
  relics: NormalizedRelic[];
  relicCount: number;
  gold: number;
  finalHp: number;
  maxHp: number;
  totalDamageTaken: number;
  eliteCount: number;
  combatCount: number;
  upgradeCount: number;
  killedBy: string | null;
  map: Record<string, unknown>[];
  timeline: TimelinePoint[];
  playerTimelines?: TimelinePoint[][];
  acts?: string[];
  modifiers?: string[];
  recordedNodeCount?: number;
  cardChoices: Array<{ floor: number; floorKnown?: boolean; offered: string[]; picked: string | null }>;
  encounterEvents: Array<Record<string, unknown> & { id: string; floor: number }>;
  relicEvents: string[];
  raw: Record<string, unknown>;
  [key: string]: unknown;
}

export type ImportSource =
  | { kind: 'directory'; id: string; label: string }
  | { kind: 'folder-input'; id: string; label: string }
  | { kind: 'single'; id: string; label: string }
  | { kind: 'demo'; id: 'demo'; label: string };

export interface ImportFailure {
  file: string;
  error: string;
}

export interface ImportResult {
  runs: NormalizedRunV2[];
  progress: CareerProgress | null;
  failures: ImportFailure[];
  warnings: string[];
  coverage: Record<string, number>;
  changes: { added: number; updated: number; unchanged: number; missing: string[] };
  parserVersion: string;
  importedAt: number;
  delta?: {
    upsertRunIds: string[];
    removedRunIds: string[];
    progressChanged: boolean;
  };
}

export interface CareerProgress {
  characterStats: Array<Record<string, unknown> & { character: string; wins?: number; losses?: number }>;
  cardStats: Array<Record<string, unknown>>;
  encounterStats: Array<Record<string, unknown>>;
  enemyStats: Array<Record<string, unknown>>;
  ancientStats: Array<Record<string, unknown>>;
  epochs: Array<Record<string, unknown>>;
  discoveries: Record<string, string[]>;
  totalPlaytime?: number;
  floorsClimbed?: number;
  totalUnlocks?: number;
  unlockedAchievements?: string[];
  recordedFields?: string[];
  [key: string]: unknown;
}

export interface FilterSpec {
  mode: string[];
  characters: string[];
  builds: string[];
  ascensions: number[];
  party: 'all' | 'solo' | 'coop';
  outcomes: RunStatus[];
  abandonPolicy?: 'include' | 'exclude-all' | 'exclude-short';
  shortAbandonMinutes?: number;
  dateFrom: string | null;
  dateTo: string | null;
  minDuration: number | null;
  maxDuration: number | null;
  includeCards: string[];
  excludeCards: string[];
  includeRelics: string[];
  excludeRelics: string[];
}

export interface CohortSpec {
  id: 'A' | 'B';
  name: string;
  filter: FilterSpec;
}

export type QueryDataSource = 'runs' | 'cards' | 'relics' | 'encounters' | 'floors' | 'players' | 'career' | 'imported';
export type VisualizationType = 'kpi' | 'table' | 'line' | 'area' | 'bar' | 'stacked-bar' | 'scatter' | 'histogram' | 'boxplot' | 'heatmap';

export interface QuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QuerySpec {
  id: string;
  dataSource: QueryDataSource;
  metricIds: string[];
  dimensionIds: string[];
  filter: FilterSpec;
  cohorts?: CohortSpec[];
  sort: QuerySort[];
  limit: number;
  visualization: VisualizationType;
  timeWindow?: number | null;
  focus?: DataItemRef;
  focuses?: DataItemRef[];
  cardCategory?: string;
}

export type EntityProfileSlice = Record<string, unknown> & { relatedRunIds?: string[] };
export type EntityProfile = { id: string; overall: EntityProfileSlice; byCharacter?: Array<Record<string, unknown>> };

export interface MetricDefinition {
  id: string;
  label: string;
  description: string;
  grain: 'run' | 'event' | 'player' | 'career';
  format: 'number' | 'percent' | 'duration' | 'floors';
  sources: QueryDataSource[];
  minSamples: number;
}

export interface DimensionDefinition {
  id: string;
  label: string;
  description: string;
  grain: 'run' | 'event' | 'player' | 'career';
  sources: QueryDataSource[];
}

export interface AnalysisRow {
  key: string;
  label: string;
  sample: number;
  values: Record<string, number | string | null>;
  cohort?: 'A' | 'B';
  items: DataItemRef[];
  drilldownIds: string[];
}

export interface AnalysisResult {
  rows: AnalysisRow[];
  sample: { total: number; eligible: number; excluded: number };
  confidence: Array<{ key: string; low: number; high: number }>;
  reliability: 'strong' | 'moderate' | 'limited';
  warnings: string[];
  query: QuerySpec;
  generatedAt: number;
  scope?: DataScope;
}

export interface SavedView {
  id: string;
  name: string;
  query: QuerySpec;
  layout: { span: number; order: number };
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  ascensionScope: 'all' | 'a10';
  abandonPolicy: 'include' | 'exclude-all' | 'exclude-short';
  shortAbandonMinutes: number;
  cardMinSeen: number;
  encounterMinFights: number;
  relicMinRuns: number;
  trendWindow: number;
  comboMinRuns: number;
}

export interface ImportFilePayload {
  name: string;
  size: number;
  lastModified: number;
  text: string;
  digest?: string;
}

export interface AnalysisWorkerApi {
  importFiles(files: ImportFilePayload[], source: ImportSource, known?: Record<string, string>): Promise<ImportResult>;
  refreshSource(files: ImportFilePayload[], source: ImportSource, known?: Record<string, string>): Promise<ImportResult>;
  executeQuery(runs: NormalizedRunV2[], query: QuerySpec): Promise<AnalysisResult>;
  getEntityProfile(runs: NormalizedRunV2[], kind: 'card' | 'relic' | 'encounter', id: string): Promise<Record<string, unknown>>;
  getRunReplay(run: NormalizedRunV2, playerIndex?: number): Promise<TimelinePoint[]>;
  analyzePreferenceArena(runs: NormalizedRunV2[], scope?: { source?: 'ancient' | 'card'; ancientId?: string; playerCharacter?: string; cardCategory?: string; focusItemId?: string }): Promise<unknown>;
  analyzeCardArchetypes(runs: NormalizedRunV2[], characterId: string): Promise<unknown>;
  exportRows(result: AnalysisResult): Promise<string>;
}
