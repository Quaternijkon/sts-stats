import type { CardPool } from './cardPools.js';
import type { CareerProgress, FilterSpec, NormalizedRunV2 } from './types.js';

export const OBJECT_KINDS = ['card', 'relic', 'encounter', 'ancient', 'potion', 'event', 'enemy', 'enchantment', 'quest', 'restChoice', 'badge', 'epoch', 'achievement', 'location', 'modifier', 'character', 'build', 'ascension', 'outcome', 'party', 'gameMode', 'floor', 'act', 'date', 'week', 'playerPosition', 'roomType'] as const;
export type ObjectKind = typeof OBJECT_KINDS[number];
export type ObjectSource = 'run' | 'career' | 'discovery';
export type ObjectMetricFormat = 'number' | 'percent' | 'duration' | 'date' | 'text';
export interface ObjectRef { kind: ObjectKind; id: string; label?: string }
export interface ObjectIdentity extends ObjectRef { label: string }

/** One recorded behavior. Sources merge only overlapping records of the same behavior. */
export interface ObjectObservation {
  object: ObjectRef;
  run: NormalizedRunV2;
  playerIndex: number;
  character: string;
  floor: number | null;
  act: number | null;
  event: string;
  sources: string[];
  related: ObjectRef[];
  amount?: number;
  choiceId?: string;
  choiceLabel?: string;
  telemetry?: { damageTaken?: number; turns?: number; hp?: number; maxHp?: number; gold?: number; hpHealed?: number; goldGained?: number; goldSpent?: number; killedPlayer?: boolean };
}
export interface ObjectMetric { id: string; label: string; value: number | null; format: ObjectMetricFormat; text?: string; help?: string }
export interface ObjectCareerRecord { id: string; object: ObjectRef; character: string | null; source: 'career' | 'discovery'; metrics: ObjectMetric[]; state: string | null; obtainedAt: number | null; discovered: boolean | null }
export interface ObjectSummary { observations: number; runs: number; completedRuns: number; wins: number; winRate: number | null; averageFloor: number | null; offered: number; picked: number; acquired: number; held: number }
export interface ObjectRow extends ObjectIdentity { cardPool?: CardPool; fills?: Record<string, number>; heat?: Record<string, number>; key: string; summary: ObjectSummary; sources: ObjectSource[]; discovered: boolean | null; metrics?: ObjectMetric[]; careerMetrics?: ObjectMetric[]; careerState?: string | null }
export interface ObjectScope { runs: 'solo'; career: 'lifetime'; careerCharacterFilter: string[]; careerIgnoresRunFilters: boolean }
export interface ObjectListResponse { kind: ObjectKind; items: ObjectRow[]; total: number; offset: number; limit: number; scope: ObjectScope; columns?: Array<ObjectMetric & { key: string; source: 'run' | 'career' }> }
export interface ObjectTableColumn { id: string; label: string; format: ObjectMetricFormat; help?: string }
export interface ObjectTableRow { id: string; label: string; values: Record<string, number | string | null>; object?: ObjectIdentity; fills?: Record<string, number>; heat?: Record<string, number> }
export interface ObjectBreakdown { id: string; label: string; help?: string; columns: ObjectTableColumn[]; rows: ObjectTableRow[] }
export interface RelatedObject extends ObjectIdentity { key: string; observations: number; runs: number }
export interface ObjectRunRef { id: string; character: string; status: string; floor: number; startTime: number }
export interface ObjectEvidence { id: string; event: string; source: string; runId: string; playerIndex: number; character: string; floor: number | null }
export interface ObjectDetailResponse {
  object: ObjectRow;
  scope: ObjectScope;
  runMetrics: ObjectMetric[];
  career: { available: boolean; scope: string; metrics: ObjectMetric[]; records: ObjectCareerRecord[] };
  breakdowns: ObjectBreakdown[];
  relatedObjects: RelatedObject[];
  runs: ObjectRunRef[];
  runTotal: number;
  runOffset: number;
  runLimit: number;
  evidence: ObjectEvidence[];
  evidenceTotal: number;
}
export interface ObjectQuery {
  minimumSample?: number;
  kind: ObjectKind;
  id?: string;
  filter?: Partial<FilterSpec>;
  perspective?: string;
  cardPool?: CardPool | 'all';
  search?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
  offset?: number;
  limit?: number;
  runOffset?: number;
  runLimit?: number;
}
export interface ObjectDataset { runs: NormalizedRunV2[]; progress: CareerProgress | null }

export function objectKey(object: ObjectRef): string { return `${object.kind}:${object.id}`; }
