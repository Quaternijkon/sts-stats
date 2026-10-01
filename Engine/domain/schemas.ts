import { z } from 'zod';
import { OBJECT_KINDS } from './objectTypes.js';
import type { CareerProgress, FilterSpec, NormalizedRunV2, QuerySpec } from './types.js';

const shortString = z.string().max(256);
const identifier = z.string().max(512);
const finiteNumber = z.number().finite();
const boundedCount = z.number().finite().min(0).max(1_000_000_000_000_000);

const characterProgressSchema = z.object({
  recordedFields: z.array(shortString).max(128).optional(),
  character: shortString,
  wins: boundedCount.optional(),
  losses: boundedCount.optional(),
  playtime: boundedCount.optional(),
  fastestWinTime: boundedCount.optional(),
  bestWinStreak: boundedCount.optional(),
  currentStreak: boundedCount.optional(),
  maxAscension: finiteNumber.min(0).max(100).optional(),
  preferredAscension: finiteNumber.min(0).max(100).optional(),
  badges: z.array(z.object({ id: identifier, rarity: shortString, count: boundedCount.optional(), recordedFields: z.array(shortString).max(128).optional() })).max(1_000).optional().default([])
});

const entityProgressSchema = z.object({ recordedFields: z.array(shortString).max(128).optional(), id: identifier, character: shortString.optional(), picked: boundedCount.optional(), skipped: boundedCount.optional(), wins: boundedCount.optional(), losses: boundedCount.optional() });
const encounterProgressSchema = z.object({
  recordedFields: z.array(shortString).max(128).optional(),
  id: identifier,
  characters: z.array(z.object({ recordedFields: z.array(shortString).max(128).optional(), character: shortString, wins: boundedCount.optional(), losses: boundedCount.optional() })).max(128).default([])
});

export const careerProgressSchema = z.object({
  recordedFields: z.array(shortString).max(128).optional(),
  characterStats: z.array(characterProgressSchema).max(128).default([]),
  cardStats: z.array(entityProgressSchema).max(20_000).default([]),
  encounterStats: z.array(encounterProgressSchema).max(10_000).default([]),
  enemyStats: z.array(encounterProgressSchema).max(10_000).default([]),
  ancientStats: z.array(encounterProgressSchema).max(10_000).default([]),
  epochs: z.array(z.object({ recordedFields: z.array(shortString).max(128).optional(), id: identifier, discovered: z.boolean().optional(), obtainDate: boundedCount.optional(), state: shortString })).max(10_000).default([]),
  discoveries: z.record(shortString, z.array(identifier).max(50_000)).default({}),
  totalPlaytime: boundedCount.optional(),
  floorsClimbed: boundedCount.optional(),
  totalUnlocks: boundedCount.optional(),
  architectDamage: boundedCount.optional(),
  currentScore: boundedCount.optional(),
  maxMultiplayerAscension: finiteNumber.min(0).max(100).optional(),
  preferredMultiplayerAscension: finiteNumber.min(0).max(100).optional(),
  testSubjectKills: boundedCount.optional(),
  wongoPoints: boundedCount.optional(),
  unlockedAchievements: z.array(identifier).max(10_000).optional(),
  rawVersion: finiteNumber.min(0).max(1_000_000).optional()
});

export const runStatusSchema = z.enum(['win', 'loss', 'abandoned']);

export const filterSpecSchema = z.object({
  mode: z.array(z.string()).default([]),
  characters: z.array(z.string()).default([]),
  builds: z.array(z.string()).default([]),
  ascensions: z.array(z.number().int().min(0).max(99)).default([]),
  party: z.enum(['all', 'solo', 'coop']).default('all'),
  outcomes: z.array(runStatusSchema).default([]),
  abandonPolicy: z.enum(['include', 'exclude-all', 'exclude-short']).default('include'),
  shortAbandonMinutes: z.number().int().min(1).max(1440).default(5),
  dateFrom: z.string().nullable().default(null),
  dateTo: z.string().nullable().default(null),
  minDuration: z.number().nonnegative().nullable().default(null),
  maxDuration: z.number().nonnegative().nullable().default(null),
  includeCards: z.array(z.string()).default([]),
  excludeCards: z.array(z.string()).default([]),
  includeRelics: z.array(z.string()).default([]),
  excludeRelics: z.array(z.string()).default([])
});

const normalizedCardSchema = z.looseObject({ id: identifier, floorAdded: finiteNumber.optional(), floorKnown: z.boolean().optional(), upgradeLevel: finiteNumber.optional(), upgradeKnown: z.boolean().optional() });
const normalizedRelicSchema = z.looseObject({ id: identifier, floorAdded: finiteNumber.optional(), floorKnown: z.boolean().optional() });
const choiceSchema = z.looseObject({ id: identifier, picked: z.boolean(), upgradeLevel: finiteNumber.optional() });
const choiceTitleSchema = z.object({ table: shortString, key: identifier });
const idsSchema = z.array(identifier).max(50_000);
const timelinePointSchema = z.looseObject({
  floor: finiteNumber,
  recordedFields: z.array(shortString).max(128).optional(),
  turns: finiteNumber.optional(),
  ancientId: identifier.nullable().optional(),
  cardsGained: z.array(normalizedCardSchema).max(50_000).optional(),
  cardsRemoved: z.array(normalizedCardSchema).max(50_000).optional(),
  cardsTransformed: z.array(z.object({ from: normalizedCardSchema.nullable(), to: normalizedCardSchema.nullable() })).max(50_000).optional(),
  upgradedCards: idsSchema.optional(),
  downgradedCards: idsSchema.optional(),
  enchantedCards: z.array(z.object({ card: normalizedCardSchema.nullable(), enchantment: identifier, amount: finiteNumber.optional() })).max(50_000).optional(),
  cardChoices: z.array(choiceSchema).max(50_000).optional(),
  relicChoices: z.array(choiceSchema).max(50_000).optional(),
  potionChoices: z.array(choiceSchema).max(50_000).optional(),
  boughtRelics: idsSchema.optional(),
  relicsRemoved: idsSchema.optional(),
  relicsGained: idsSchema.optional(),
  boughtColorless: idsSchema.optional(),
  potionsUsed: idsSchema.optional(),
  potionsBought: idsSchema.optional(),
  potionsDiscarded: idsSchema.optional(),
  potionsGained: idsSchema.optional(),
  eventChoices: z.array(z.object({ title: choiceTitleSchema, id: identifier.optional(), chosen: z.boolean().optional() })).max(50_000).optional(),
  ancientChoices: z.array(z.object({ relicId: identifier, title: choiceTitleSchema, chosen: z.boolean() })).max(50_000).optional(),
  completedQuests: idsSchema.optional(),
  completedQuestDetails: z.array(z.object({ id: identifier, cardId: identifier.optional() })).max(50_000).optional(),
  restChoices: idsSchema.optional()
});

export const normalizedRunV2Schema = z.object({
  modelVersion: z.literal(2),
  parserVersion: z.string(),
  sourceScope: z.enum(['history', 'imported', 'demo']),
  sourceKey: z.string(),
  importedAt: z.number(),
  capabilities: z.object({
    hasMap: z.boolean(),
    hasPlayerTelemetry: z.boolean(),
    hasCardChoices: z.boolean(),
    hasRelicEvents: z.boolean(),
    hasEncounterEvents: z.boolean(),
    hasVersion: z.boolean()
  }),
  id: z.string(),
  fileName: z.string(),
  seed: z.string(),
  buildId: z.string(),
  gameMode: z.string(),
  schemaVersion: z.number(),
  platformType: z.string(),
  players: z.array(z.looseObject({ id: z.number(), character: z.string(), deck: z.array(normalizedCardSchema).optional(), relics: z.array(normalizedRelicSchema).optional(), potions: idsSchema.optional(), badges: idsSchema.optional() })),
  playerCount: z.number(),
  isMultiplayer: z.boolean(),
  character: z.string(),
  ascension: z.number(),
  win: z.boolean(),
  status: runStatusSchema,
  floor: z.number(),
  runTime: z.number(),
  startTime: z.number(),
  deckSize: z.number(),
  deck: z.array(normalizedCardSchema),
  relics: z.array(normalizedRelicSchema),
  relicCount: z.number(),
  gold: z.number(),
  finalHp: z.number(),
  maxHp: z.number(),
  totalDamageTaken: z.number(),
  eliteCount: z.number(),
  combatCount: z.number(),
  upgradeCount: z.number(),
  killedBy: z.string().nullable(),
  map: z.array(z.record(z.string(), z.unknown())),
  timeline: z.array(timelinePointSchema),
  playerTimelines: z.array(z.array(timelinePointSchema)).optional(),
  acts: idsSchema.optional(),
  modifiers: idsSchema.optional(),
  recordedNodeCount: boundedCount.optional(),
  cardChoices: z.array(z.looseObject({ offered: z.array(z.string()), floorKnown: z.boolean().optional() })),
  encounterEvents: z.array(z.looseObject({ id: identifier, recordedFields: z.array(shortString).max(128).optional(), damageTaken: finiteNumber.optional(), turns: finiteNumber.optional(), killedPlayer: z.boolean().optional() })),
  relicEvents: z.array(z.string()),
  raw: z.record(z.string(), z.unknown())
}).loose();

export const querySpecSchema = z.object({
  id: z.string(),
  dataSource: z.enum(['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'career', 'imported']),
  metricIds: z.array(z.string()).min(1),
  dimensionIds: z.array(z.string()).max(2),
  filter: filterSpecSchema,
  cohorts: z.array(z.object({ id: z.enum(['A', 'B']), name: z.string(), filter: filterSpecSchema })).optional(),
  sort: z.array(z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) })),
  limit: z.number().int().min(1).max(500),
  visualization: z.enum(['kpi', 'table', 'line', 'area', 'bar', 'stacked-bar', 'scatter', 'histogram', 'boxplot', 'heatmap']),
  timeWindow: z.number().int().positive().nullable().optional(),
  focus: z.object({ kind: z.enum([...OBJECT_KINDS, 'run']), id: identifier, label: shortString.optional() }).optional(),
  focuses: z.array(z.object({ kind: z.enum([...OBJECT_KINDS, 'run']), id: identifier, label: shortString.optional() })).max(12).optional(),
  cardCategory: z.string().max(256).optional()
});

export const EMPTY_FILTER: FilterSpec = filterSpecSchema.parse({});

export function validateNormalizedRun(value: unknown): NormalizedRunV2 {
  return normalizedRunV2Schema.parse(value) as unknown as NormalizedRunV2;
}

export function validateQuery(value: unknown): QuerySpec {
  return querySpecSchema.parse(value) as QuerySpec;
}

export function validateCareerProgress(value: unknown): CareerProgress {
  return careerProgressSchema.parse(value) as CareerProgress;
}
