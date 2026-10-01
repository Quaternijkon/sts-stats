import type { NormalizedRunV2, RunStatus, TimelinePoint } from './types.js';
import { gameCharacters } from './game.js';

export type ChoiceOutcome = Extract<RunStatus, 'win' | 'loss'> | null;

export interface ChoiceEvent {
  eventId: string;
  candidates: string[];
  chosen: string;
  slots: Array<number | string | null>;
  runId: string | null;
  timestamp: number | null;
  outcome: ChoiceOutcome;
  gameVersion: string | null;
  metadata: Record<string, unknown>;
}

export interface ChoiceCapabilityResult {
  status: 'available' | 'history_not_available';
  canExtractChoiceHistory: boolean;
  hasRunId: boolean;
  hasTimestamp: boolean;
  hasOutcome: boolean;
  hasSlotInformation: boolean;
  hasGameVersion: boolean;
  warnings: string[];
}

export interface ChoiceParseReport {
  parser: string;
  parserVersion: string;
  eventsTotal: number;
  eventsValid: number;
  eventsRejected: number;
  uniqueItems: number;
  choiceSetSizes: Record<string, number>;
  hasOutcome: boolean;
  hasTimestamp: boolean;
  gameVersions: string[];
  warnings: string[];
}

export interface ArenaItemStats {
  id: string;
  slotCounts: number[];
  slotProfile: number[];
  slotSignature: string;
  slotMean: number;
  slotProfileStatus: 'stable' | 'nonstationary' | 'insufficient';
  offered: number;
  chosen: number;
  choiceRate: number;
  choiceCi: [number, number];
  outcomeChosen: number;
  chosenWins: number;
  winRate: number | null;
  winCi: [number, number] | null;
  componentId: number;
  theta: number;
  thetaCi: [number, number];
  rank: number;
  rankCi: [number, number];
}

export interface ArenaPairStats {
  rowId: string;
  columnId: string;
  relation: 'direct' | 'indirect' | 'na';
  pref: number | null;
  prefCi: [number, number] | null;
  directionConfidence: number | null;
  cooccurN: number;
  rowChoiceCount: number | null;
  columnChoiceCount: number | null;
  thirdChoiceCount: number | null;
  otherChoiceCount: number | null;
  rowShare: number | null;
  columnShare: number | null;
  thirdShare: number | null;
  otherShare: number | null;
  commonNeighbors: number;
  shortestPath: number | null;
  componentId: number | null;
}

export interface SlotStructureDiagnostics {
  componentId: number;
  slotCount: number;
  contingencyTable: number[][];
  testMethod: 'permutation_chi_square';
  permutations: number;
  pValue: number;
  cramersV: number;
  topologyEnabled: boolean;
  distanceMetric: 'jensen_shannon';
  orderingMethod: 'hierarchical_average_leaf_seriation' | 'greedy_slot_seriation' | 'arena_fallback';
}

export interface AxisOrderingResult {
  componentId: number;
  order: string[];
  mode: 'slot_topology' | 'arena_fallback';
  adjacentSlotDistance: number[];
  separatorStrength: number[];
  orientation: 'early_to_late';
  diagnostics: { slotStructureP: number; slotStructureEffect: number };
}

export interface ArenaComponentDiagnostics {
  componentId: number;
  itemCount: number;
  eventCount: number;
  converged: boolean;
  iterations: number;
  covarianceStable: boolean;
  posteriorDraws: number;
  meanLogLoss: number;
  status: 'stable' | 'unstable';
}

export interface PreferenceArenaResult {
  status: 'available' | 'history_not_available' | 'unstable';
  method: 'regularized_plackett_luce_laplace';
  itemCategory: 'cards' | 'relics';
  generatedAt: number;
  capability: ChoiceCapabilityResult;
  parseReport: ChoiceParseReport;
  events: ChoiceEvent[];
  items: Record<string, ArenaItemStats>;
  pairs: Record<string, ArenaPairStats>;
  ordering: string[];
  orderings: { adaptive: string[]; arena: string[]; choiceRate: string[]; slotMean: string[] };
  slotLabels: Array<number | string>;
  slotStructure: Record<string, SlotStructureDiagnostics>;
  axisOrdering: Record<string, AxisOrderingResult>;
  components: Array<{ componentId: number; itemIds: string[] }>;
  diagnostics: ArenaComponentDiagnostics[];
  temporalMetadata: { firstEvent: number | null; lastEvent: number | null; numRuns: number; gameVersions: string[] };
  warnings: string[];
}

export interface PreferenceArenaScope {
  source?: 'ancient' | 'card';
  ancientId?: string;
  playerCharacter?: string;
  cardCategory?: CardArenaCategory;
  focusItemId?: string;
}

export type CardArenaCategory = string;

export interface CardCategoryStats {
  id: string;
  counts: Record<string, number>;
  total: number;
  profile: number[];
  baselineProfile: number[];
  distanceFromBaseline: number;
  colorless: boolean;
}

export interface CardCategoryClassification {
  characters: string[];
  colorlessIds: string[];
  stats: Record<string, CardCategoryStats>;
  config: { minPerCharacter: number; minTotal: number; maxJensenShannonDistance: number; smoothingAlpha: number };
}

export type ChoiceNormalizationResult = { capability: ChoiceCapabilityResult; report: ChoiceParseReport; events: ChoiceEvent[] };
type ComponentFit = { itemIds: string[]; samples: number[][]; medians: number[]; lows: number[]; highs: number[]; ranks: number[][]; variances: number[]; diagonalApproximation: boolean; diagnostics: ArenaComponentDiagnostics };

function relicId(choice: Record<string, unknown>): string {
  const direct = String(choice.relicId || choice.id || '');
  if (direct) return direct.startsWith('RELIC.') ? direct : `RELIC.${direct.replace(/\.title$/i, '')}`;
  const title = choice.title as { key?: unknown } | undefined;
  const key = String(title?.key || choice.TextKey || choice.textKey || '').replace(/\.title$/i, '');
  return key ? (key.startsWith('RELIC.') ? key : `RELIC.${key}`) : '';
}

function timelineForPlayers(run: NormalizedRunV2): TimelinePoint[][] {
  return run.playerTimelines?.length ? run.playerTimelines : [run.timeline || []];
}

function validateEvent(event: ChoiceEvent): string | null {
  if (event.candidates.length < 2) return '候选数少于 2';
  if (new Set(event.candidates).size !== event.candidates.length) return '候选项重复';
  if (!event.candidates.includes(event.chosen)) return '选择项不在候选集中';
  if (event.slots.length !== event.candidates.length) return '槽位与候选项数量不一致';
  return null;
}

export class AncientChoiceEventNormalizer {
  static readonly parserName = 'sts2-normalized-ancient-choice';
  static readonly parserVersion = '1.0.0';

  normalize(runs: NormalizedRunV2[]): ChoiceNormalizationResult {
    const valid: ChoiceEvent[] = [];
    const warnings: string[] = [];
    let total = 0;
    let rejected = 0;
    const sizes = new Map<number, number>();
    for (const run of runs) {
      const timelines = timelineForPlayers(run);
      for (let playerIndex = 0; playerIndex < timelines.length; playerIndex += 1) {
        for (const point of timelines[playerIndex] || []) {
          const rawChoices = Array.isArray(point.ancientChoices) ? point.ancientChoices as Record<string, unknown>[] : [];
          if (!rawChoices.length) continue;
          total += 1;
          const candidates = rawChoices.map(relicId).filter(Boolean);
          const selected = rawChoices.find((choice) => Boolean(choice.chosen));
          const chosen = selected ? relicId(selected) : '';
          const event: ChoiceEvent = {
            eventId: `${run.id}:${playerIndex}:${Number(point.floor || 0)}`,
            candidates,
            chosen,
            slots: candidates.map((_, index) => index + 1),
            runId: run.id || null,
            timestamp: Number.isFinite(run.startTime) && run.startTime > 0 ? run.startTime : null,
            outcome: run.status === 'win' || run.status === 'loss' ? run.status : null,
            gameVersion: run.buildId || null,
            metadata: {
              ancientId: String(point.ancientId || point.label || ''),
              floor: Number(point.floor || 0),
              act: Number(point.act || 0),
              playerIndex,
              playerCharacter: run.players[playerIndex]?.character || run.character
            }
          };
          const invalid = validateEvent(event);
          if (invalid) {
            rejected += 1;
            if (warnings.length < 12) warnings.push(`${event.eventId}：${invalid}`);
            continue;
          }
          valid.push(event);
          sizes.set(candidates.length, (sizes.get(candidates.length) || 0) + 1);
        }
      }
    }
    const arenaEvents = valid.filter((event) => event.candidates.length === 3);
    if (valid.length > arenaEvents.length) warnings.push(`${valid.length - arenaEvents.length} 条非三选一事件已保留在解析报告中，但不进入 Arena v1。`);
    if (!arenaEvents.length) warnings.push('当前存档没有可确认的三选一 ancient_choice 历史。');
    const hasOutcome = arenaEvents.some((event) => event.outcome !== null);
    if (arenaEvents.length && !hasOutcome) warnings.push('存档有选择历史，但没有可用的对局结果；将不显示选择后胜率。');
    const capability: ChoiceCapabilityResult = {
      status: arenaEvents.length ? 'available' : 'history_not_available',
      canExtractChoiceHistory: arenaEvents.length > 0,
      hasRunId: arenaEvents.every((event) => Boolean(event.runId)),
      hasTimestamp: arenaEvents.some((event) => event.timestamp !== null),
      hasOutcome,
      hasSlotInformation: arenaEvents.every((event) => event.slots.every((slot) => slot !== null)),
      hasGameVersion: arenaEvents.some((event) => Boolean(event.gameVersion)),
      warnings
    };
    return {
      capability,
      events: arenaEvents,
      report: {
        parser: AncientChoiceEventNormalizer.parserName,
        parserVersion: AncientChoiceEventNormalizer.parserVersion,
        eventsTotal: total,
        eventsValid: valid.length,
        eventsRejected: rejected,
        uniqueItems: new Set(arenaEvents.flatMap((event) => event.candidates)).size,
        choiceSetSizes: Object.fromEntries([...sizes.entries()].map(([size, count]) => [String(size), count])),
        hasOutcome,
        hasTimestamp: capability.hasTimestamp,
        gameVersions: [...new Set(arenaEvents.flatMap((event) => event.gameVersion ? [event.gameVersion] : []))].sort(),
        warnings
      }
    };
  }
}

function cardChoiceGroups(runs: NormalizedRunV2[]): Array<{ run: NormalizedRunV2; playerIndex: number; playerCharacter: string; point: TimelinePoint; choices: Record<string, unknown>[] }> {
  const groups: Array<{ run: NormalizedRunV2; playerIndex: number; playerCharacter: string; point: TimelinePoint; choices: Record<string, unknown>[] }> = [];
  for (const run of runs) {
    const timelines = timelineForPlayers(run);
    for (let playerIndex = 0; playerIndex < timelines.length; playerIndex += 1) for (const point of timelines[playerIndex] || []) {
      const choices = Array.isArray(point.cardChoices) ? point.cardChoices as unknown as Record<string, unknown>[] : [];
      if (choices.length) groups.push({ run, playerIndex, playerCharacter: run.players[playerIndex]?.character || run.character, point, choices });
    }
  }
  return groups;
}

export function classifyCardAvailability(runs: NormalizedRunV2[]): CardCategoryClassification {
  const characters = [...gameCharacters()];
  const config = { minPerCharacter: 2, minTotal: 20, maxJensenShannonDistance: 0.12, smoothingAlpha: 0.5 };
  const counts = new Map<string, Record<string, number>>();
  const baselineCounts = Object.fromEntries(characters.map((character) => [character, 0])) as Record<string, number>;
  for (const group of cardChoiceGroups(runs)) {
    if (!characters.includes(group.playerCharacter)) continue;
    for (const choice of group.choices) {
      const id = String(choice.id || ''); if (!id) continue;
      baselineCounts[group.playerCharacter] += 1;
      const row = counts.get(id) || Object.fromEntries(characters.map((character) => [character, 0])) as Record<string, number>;
      row[group.playerCharacter] += 1; counts.set(id, row);
    }
  }
  const baselineTotal = characters.reduce((sum, character) => sum + baselineCounts[character], 0);
  const baselineProfile = characters.map((character) => (baselineCounts[character] + config.smoothingAlpha) / Math.max(1, baselineTotal + characters.length * config.smoothingAlpha));
  const stats: Record<string, CardCategoryStats> = {};
  for (const [id, row] of counts) {
    const total = characters.reduce((sum, character) => sum + row[character], 0);
    const profile = characters.map((character) => (row[character] + config.smoothingAlpha) / Math.max(1, total + characters.length * config.smoothingAlpha));
    const distanceFromBaseline = jensenShannon(profile, baselineProfile);
    const colorless = total >= config.minTotal && characters.every((character) => row[character] >= config.minPerCharacter) && distanceFromBaseline <= config.maxJensenShannonDistance;
    stats[id] = { id, counts: row, total, profile, baselineProfile, distanceFromBaseline, colorless };
  }
  return { characters, colorlessIds: Object.values(stats).filter((row) => row.colorless).map((row) => row.id).sort(), stats, config };
}

export class CardChoiceEventNormalizer {
  static readonly parserName = 'sts2-normalized-card-choice';
  static readonly parserVersion = '1.0.0';

  normalize(runs: NormalizedRunV2[]): ChoiceNormalizationResult {
    const events: ChoiceEvent[] = []; const warnings: string[] = []; const sizes = new Map<number, number>();
    let total = 0; let rejected = 0; let skipped = 0;
    for (const group of cardChoiceGroups(runs)) {
      total += 1;
      const candidates = group.choices.map((choice) => String(choice.id || '')).filter(Boolean);
      const selectedChoices = group.choices.filter((choice) => Boolean(choice.picked));
      if (!selectedChoices.length) { skipped += 1; continue; }
      if (selectedChoices.length > 1) {
        rejected += 1;
        if (warnings.length < 8) warnings.push(`${group.run.id}:${group.playerIndex}:${Number(group.point.floor || 0)}:card：同一候选记录包含 ${selectedChoices.length} 张被选卡，无法作为单选偏好事件。`);
        continue;
      }
      const selected = selectedChoices[0];
      const chosen = String(selected.id || '');
      const event: ChoiceEvent = {
        eventId: `${group.run.id}:${group.playerIndex}:${Number(group.point.floor || 0)}:card`, candidates, chosen, slots: candidates.map((_, index) => index + 1),
        runId: group.run.id || null, timestamp: group.run.startTime > 0 ? group.run.startTime : null,
        outcome: group.run.status === 'win' || group.run.status === 'loss' ? group.run.status : null, gameVersion: group.run.buildId || null,
        metadata: { source: 'card', floor: Number(group.point.floor || 0), act: Number(group.point.act || 0), playerIndex: group.playerIndex, playerCharacter: group.playerCharacter }
      };
      const invalid = validateEvent(event);
      if (invalid) { rejected += 1; if (warnings.length < 8) warnings.push(`${event.eventId}：${invalid}`); continue; }
      events.push(event); sizes.set(candidates.length, (sizes.get(candidates.length) || 0) + 1);
    }
    if (skipped) warnings.push(`${skipped} 条跳过卡牌奖励没有可确认的 chosen 卡牌，未进入偏好模型。`);
    if (!events.length) warnings.push('当前存档没有可用的已选卡牌候选历史。');
    const hasOutcome = events.some((event) => event.outcome !== null);
    const capability: ChoiceCapabilityResult = { status: events.length ? 'available' : 'history_not_available', canExtractChoiceHistory: events.length > 0, hasRunId: events.every((event) => Boolean(event.runId)), hasTimestamp: events.some((event) => event.timestamp !== null), hasOutcome, hasSlotInformation: events.every((event) => event.slots.every((slot) => slot !== null)), hasGameVersion: events.some((event) => Boolean(event.gameVersion)), warnings };
    return { capability, events, report: { parser: CardChoiceEventNormalizer.parserName, parserVersion: CardChoiceEventNormalizer.parserVersion, eventsTotal: total, eventsValid: events.length, eventsRejected: rejected + skipped, uniqueItems: new Set(events.flatMap((event) => event.candidates)).size, choiceSetSizes: Object.fromEntries([...sizes].map(([size, count]) => [String(size), count])), hasOutcome, hasTimestamp: capability.hasTimestamp, gameVersions: [...new Set(events.flatMap((event) => event.gameVersion ? [event.gameVersion] : []))].sort(), warnings } };
  }
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function randomGenerator(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function normalRandom(random: () => number): number {
  const left = Math.max(random(), 1e-12);
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function gammaRandom(shape: number, random: () => number): number {
  if (shape < 1) return gammaRandom(shape + 1, random) * Math.pow(Math.max(random(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = normalRandom(random);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = random();
    if (u < 1 - 0.0331 * Math.pow(x, 4) || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaInterval(successes: number, total: number, seed: string): [number, number] {
  const random = randomGenerator(hashSeed(seed));
  const values: number[] = [];
  const alpha = successes + 0.5;
  const beta = total - successes + 0.5;
  for (let index = 0; index < 3000; index += 1) {
    const left = gammaRandom(alpha, random);
    const right = gammaRandom(beta, random);
    values.push(left / (left + right));
  }
  values.sort((a, b) => a - b);
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

function quantile(sorted: number[], probability: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(sorted.length - 1, lower + 1)] - sorted[lower]) * fraction;
}

function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function solve(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

function inverse(matrix: number[][]): number[][] | null {
  const columns: number[][] = [];
  for (let column = 0; column < matrix.length; column += 1) {
    const unit = Array.from({ length: matrix.length }, (_, index) => index === column ? 1 : 0);
    const solved = solve(matrix, unit);
    if (!solved) return null;
    columns.push(solved);
  }
  return matrix.map((_, row) => columns.map((column) => column[row]));
}

function cholesky(matrix: number[][]): number[][] | null {
  const size = matrix.length;
  const result = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) for (let column = 0; column <= row; column += 1) {
    let sum = matrix[row][column];
    for (let index = 0; index < column; index += 1) sum -= result[row][index] * result[column][index];
    if (row === column) {
      if (sum <= 1e-12) return null;
      result[row][column] = Math.sqrt(sum);
    } else result[row][column] = sum / result[column][column];
  }
  return result;
}

function center(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return values.map((value) => value - mean);
}

function componentGraph(events: ChoiceEvent[]) {
  const adjacency = new Map<string, Set<string>>();
  const cooccurrence = new Map<string, number>();
  for (const event of events) {
    for (const item of event.candidates) if (!adjacency.has(item)) adjacency.set(item, new Set());
    for (let left = 0; left < event.candidates.length; left += 1) for (let right = left + 1; right < event.candidates.length; right += 1) {
      const a = event.candidates[left]; const b = event.candidates[right];
      adjacency.get(a)!.add(b); adjacency.get(b)!.add(a);
      const key = [a, b].sort().join('¦');
      cooccurrence.set(key, (cooccurrence.get(key) || 0) + 1);
    }
  }
  const components: string[][] = [];
  const componentByItem = new Map<string, number>();
  for (const start of [...adjacency.keys()].sort()) {
    if (componentByItem.has(start)) continue;
    const id = components.length;
    const queue = [start]; const items: string[] = []; componentByItem.set(start, id);
    while (queue.length) {
      const item = queue.shift()!; items.push(item);
      for (const neighbor of adjacency.get(item) || []) if (!componentByItem.has(neighbor)) { componentByItem.set(neighbor, id); queue.push(neighbor); }
    }
    components.push(items.sort());
  }
  const distances = new Map<string, Map<string, number>>();
  for (const start of adjacency.keys()) {
    const values = new Map<string, number>([[start, 0]]); const queue = [start];
    while (queue.length) { const item = queue.shift()!; for (const neighbor of adjacency.get(item) || []) if (!values.has(neighbor)) { values.set(neighbor, values.get(item)! + 1); queue.push(neighbor); } }
    distances.set(start, values);
  }
  return { adjacency, cooccurrence, components, componentByItem, distances };
}

function chiSquare(table: number[][]): number {
  const rowTotals = table.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = table[0]?.map((_, column) => table.reduce((sum, row) => sum + row[column], 0)) || [];
  const total = rowTotals.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  let value = 0;
  for (let row = 0; row < table.length; row += 1) for (let column = 0; column < columnTotals.length; column += 1) {
    const expected = rowTotals[row] * columnTotals[column] / total;
    if (expected > 0) value += Math.pow(table[row][column] - expected, 2) / expected;
  }
  return value;
}

function jensenShannon(left: number[], right: number[]): number {
  const midpoint = left.map((value, index) => (value + right[index]) / 2);
  const kl = (source: number[], target: number[]) => source.reduce((sum, value, index) => sum + (value > 0 ? value * Math.log2(value / target[index]) : 0), 0);
  return Math.sqrt(Math.max(0, (kl(left, midpoint) + kl(right, midpoint)) / 2));
}

function slotStructureDiagnostics(componentId: number, itemIds: string[], items: Record<string, ArenaItemStats>, permutations = 400): SlotStructureDiagnostics {
  const table = itemIds.map((id) => [...items[id].slotCounts]);
  const slotCount = table[0]?.length || 0;
  const total = table.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0), 0);
  if (itemIds.length < 2 || slotCount < 2 || !total) return { componentId, slotCount, contingencyTable: table, testMethod: 'permutation_chi_square', permutations, pValue: 1, cramersV: 0, topologyEnabled: false, distanceMetric: 'jensen_shannon', orderingMethod: 'arena_fallback' };
  const observed = chiSquare(table);
  const rowTotals = table.map((row) => row.reduce((sum, value) => sum + value, 0));
  const slotPool = table[0].flatMap((_, column) => Array.from({ length: table.reduce((sum, row) => sum + row[column], 0) }, () => column));
  const random = randomGenerator(hashSeed(`slot-structure:${componentId}:${itemIds.join('|')}:${total}`));
  let extreme = 0;
  for (let permutation = 0; permutation < permutations; permutation += 1) {
    const shuffled = [...slotPool];
    for (let index = shuffled.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]; }
    let cursor = 0;
    const permuted = rowTotals.map((rowTotal) => { const row = Array(slotCount).fill(0); for (let index = 0; index < rowTotal; index += 1) row[shuffled[cursor++]] += 1; return row; });
    if (chiSquare(permuted) >= observed - 1e-12) extreme += 1;
  }
  const pValue = (extreme + 1) / (permutations + 1);
  const cramersV = Math.sqrt(observed / (total * Math.max(1, Math.min(itemIds.length - 1, slotCount - 1))));
  const topologyEnabled = pValue < 0.05 && cramersV >= 0.10;
  return { componentId, slotCount, contingencyTable: table, testMethod: 'permutation_chi_square', permutations, pValue, cramersV, topologyEnabled, distanceMetric: 'jensen_shannon', orderingMethod: topologyEnabled ? itemIds.length > 80 ? 'greedy_slot_seriation' : 'hierarchical_average_leaf_seriation' : 'arena_fallback' };
}

function pathCost(order: string[], distance: Map<string, Map<string, number>>): number {
  let cost = 0;
  for (let index = 0; index < order.length - 1; index += 1) cost += distance.get(order[index])?.get(order[index + 1]) || 0;
  return cost;
}

function topologyOrder(itemIds: string[], items: Record<string, ArenaItemStats>): string[] {
  const rawDistances = itemIds.flatMap((left, leftIndex) => itemIds.slice(leftIndex + 1).map((right) => jensenShannon(items[left].slotProfile, items[right].slotProfile))).filter((value) => value > 0);
  const sortedNonzero = [...rawDistances].sort((a, b) => a - b);
  const epsilon = sortedNonzero.length ? median(sortedNonzero) * 1e-3 : 0;
  const distance = new Map<string, Map<string, number>>();
  for (const left of itemIds) {
    const row = new Map<string, number>();
    for (const right of itemIds) row.set(right, jensenShannon(items[left].slotProfile, items[right].slotProfile) + epsilon * Math.abs(items[left].rank - items[right].rank) / Math.max(1, itemIds.length - 1));
    distance.set(left, row);
  }
  if (itemIds.length > 80) {
    const remaining = new Set(itemIds);
    const first = [...remaining].sort((left, right) => items[left].slotMean - items[right].slotMean || items[left].rank - items[right].rank || left.localeCompare(right))[0];
    const order = [first]; remaining.delete(first);
    while (remaining.size) {
      const current = order.at(-1)!;
      const next = [...remaining].sort((left, right) => (distance.get(current)?.get(left) || 0) - (distance.get(current)?.get(right) || 0) || items[left].rank - items[right].rank || left.localeCompare(right))[0];
      order.push(next); remaining.delete(next);
    }
    const midpoint = Math.floor(order.length / 2); const early = order.slice(0, midpoint).reduce((sum, id) => sum + items[id].slotMean, 0) / Math.max(1, midpoint); const late = order.slice(midpoint).reduce((sum, id) => sum + items[id].slotMean, 0) / Math.max(1, order.length - midpoint);
    return early <= late ? order : order.reverse();
  }
  let clusters = itemIds.map((id) => ({ items: [id], order: [id], key: id }));
  while (clusters.length > 1) {
    let bestLeft = 0; let bestRight = 1; let bestDistance = Number.POSITIVE_INFINITY; let bestKey = '';
    for (let left = 0; left < clusters.length; left += 1) for (let right = left + 1; right < clusters.length; right += 1) {
      const values = clusters[left].items.flatMap((a) => clusters[right].items.map((b) => distance.get(a)?.get(b) || 0));
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const key = `${clusters[left].key}¦${clusters[right].key}`;
      if (average < bestDistance - 1e-12 || Math.abs(average - bestDistance) <= 1e-12 && key < bestKey) { bestLeft = left; bestRight = right; bestDistance = average; bestKey = key; }
    }
    const left = clusters[bestLeft]; const right = clusters[bestRight];
    const leftOrders = [left.order, [...left.order].reverse()]; const rightOrders = [right.order, [...right.order].reverse()];
    const candidates = leftOrders.flatMap((a) => rightOrders.flatMap((b) => [[...a, ...b], [...b, ...a]])).sort((a, b) => pathCost(a, distance) - pathCost(b, distance) || a.join('|').localeCompare(b.join('|')));
    const merged = { items: [...left.items, ...right.items].sort(), order: candidates[0], key: [...left.items, ...right.items].sort().join('|') };
    clusters = clusters.filter((_, index) => index !== bestLeft && index !== bestRight); clusters.push(merged);
  }
  const order = clusters[0]?.order || [];
  const midpoint = Math.floor(order.length / 2);
  const early = order.slice(0, midpoint).reduce((sum, id) => sum + items[id].slotMean, 0) / Math.max(1, midpoint);
  const late = order.slice(midpoint).reduce((sum, id) => sum + items[id].slotMean, 0) / Math.max(1, order.length - midpoint);
  return early <= late ? order : [...order].reverse();
}

function separatorStrength(distances: number[]): number[] {
  if (!distances.length) return [];
  const sorted = [...distances].sort((a, b) => a - b);
  const q50 = quantile(sorted, 0.5); const q90 = quantile(sorted, 0.9);
  return distances.map((value) => value >= q90 && q90 > q50 ? 4 : value > q50 ? 2 : 1);
}

function itemSlotCounts(id: string, events: ChoiceEvent[], slotLabels: Array<number | string>): number[] {
  const counts = Array(slotLabels.length).fill(0);
  for (const event of events) event.candidates.forEach((candidate, index) => {
    if (candidate !== id || event.slots[index] === null) return;
    const slotIndex = slotLabels.findIndex((slot) => String(slot) === String(event.slots[index]));
    if (slotIndex >= 0) counts[slotIndex] += 1;
  });
  return counts;
}

function smoothedProfile(counts: number[], alpha = 0.5): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  return counts.map((value) => (value + alpha) / Math.max(1, total + counts.length * alpha));
}

function slotProfileDrift(id: string, events: ChoiceEvent[], slotLabels: Array<number | string>): ArenaItemStats['slotProfileStatus'] {
  const versions = new Map<string, ChoiceEvent[]>();
  for (const event of events.filter((row) => row.candidates.includes(id) && row.gameVersion)) {
    const rows = versions.get(event.gameVersion!) || []; rows.push(event); versions.set(event.gameVersion!, rows);
  }
  const eligible = [...versions.entries()].filter(([, rows]) => rows.length >= 5);
  if (eligible.length < 2) return 'insufficient';
  const profiles = eligible.map(([, rows]) => smoothedProfile(itemSlotCounts(id, rows, slotLabels)));
  let maxDistance = 0;
  for (let left = 0; left < profiles.length; left += 1) for (let right = left + 1; right < profiles.length; right += 1) maxDistance = Math.max(maxDistance, jensenShannon(profiles[left], profiles[right]));
  return maxDistance >= 0.25 ? 'nonstationary' : 'stable';
}

function fitComponent(componentId: number, itemIds: string[], events: ChoiceEvent[], draws = 1200): ComponentFit {
  const index = new Map(itemIds.map((id, itemIndex) => [id, itemIndex]));
  const componentEvents = events.filter((event) => event.candidates.every((id) => index.has(id)));
  const theta = Array(itemIds.length).fill(0);
  const diagonalApproximation = itemIds.length > 80;
  const actualDraws = diagonalApproximation ? Math.min(500, draws) : draws;
  let converged = false;
  let iterations = 0;
  let finalHessian = Array.from({ length: itemIds.length }, (_, row) => Array.from({ length: itemIds.length }, (_, column) => row === column ? 1 : 0));
  if (diagonalApproximation) {
    const firstMoment = Array(itemIds.length).fill(0); const secondMoment = Array(itemIds.length).fill(0);
    for (iterations = 1; iterations <= 260; iterations += 1) {
      const gradient = theta.map((value) => -value);
      for (const event of componentEvents) {
        const candidateIndexes = event.candidates.map((id) => index.get(id)!);
        const utilities = candidateIndexes.map((candidate) => theta[candidate]); const max = Math.max(...utilities);
        const weights = utilities.map((utility) => Math.exp(utility - max)); const total = weights.reduce((sum, value) => sum + value, 0);
        candidateIndexes.forEach((candidate, position) => { gradient[candidate] += (event.chosen === event.candidates[position] ? 1 : 0) - weights[position] / total; });
      }
      let maxStep = 0;
      for (let item = 0; item < theta.length; item += 1) {
        firstMoment[item] = 0.9 * firstMoment[item] + 0.1 * gradient[item];
        secondMoment[item] = 0.999 * secondMoment[item] + 0.001 * gradient[item] * gradient[item];
        const correctedFirst = firstMoment[item] / (1 - Math.pow(0.9, iterations)); const correctedSecond = secondMoment[item] / (1 - Math.pow(0.999, iterations));
        const step = 0.045 * correctedFirst / (Math.sqrt(correctedSecond) + 1e-8); theta[item] += step; maxStep = Math.max(maxStep, Math.abs(step));
      }
      theta.splice(0, theta.length, ...center(theta));
      if (iterations > 40 && maxStep < 2e-5) { converged = true; break; }
    }
    const precision = Array(itemIds.length).fill(1);
    for (const event of componentEvents) {
      const candidateIndexes = event.candidates.map((id) => index.get(id)!); const utilities = candidateIndexes.map((candidate) => theta[candidate]); const max = Math.max(...utilities);
      const weights = utilities.map((utility) => Math.exp(utility - max)); const total = weights.reduce((sum, value) => sum + value, 0);
      candidateIndexes.forEach((candidate, position) => { const probability = weights[position] / total; precision[candidate] += probability * (1 - probability); });
    }
    finalHessian = precision.map((value, row) => Array.from({ length: itemIds.length }, (_, column) => row === column ? value : 0));
  } else {
    for (iterations = 1; iterations <= 80; iterations += 1) {
      const gradient = theta.map((value) => -value);
      const hessian = Array.from({ length: itemIds.length }, (_, row) => Array.from({ length: itemIds.length }, (_, column) => row === column ? 1 : 0));
      for (const event of componentEvents) {
        const candidateIndexes = event.candidates.map((id) => index.get(id)!);
        const utilities = candidateIndexes.map((candidate) => theta[candidate]);
        const max = Math.max(...utilities);
        const weights = utilities.map((utility) => Math.exp(utility - max));
        const total = weights.reduce((sum, value) => sum + value, 0);
        const probabilities = weights.map((weight) => weight / total);
        for (let left = 0; left < candidateIndexes.length; left += 1) {
          const row = candidateIndexes[left];
          gradient[row] += (event.chosen === event.candidates[left] ? 1 : 0) - probabilities[left];
          for (let right = 0; right < candidateIndexes.length; right += 1) {
            const column = candidateIndexes[right];
            hessian[row][column] += (left === right ? probabilities[left] : 0) - probabilities[left] * probabilities[right];
          }
        }
      }
      const step = solve(hessian, gradient);
      if (!step) break;
      const next = center(theta.map((value, itemIndex) => value + step[itemIndex]));
      const change = Math.max(...next.map((value, itemIndex) => Math.abs(value - theta[itemIndex])));
      theta.splice(0, theta.length, ...next);
      finalHessian = hessian;
      if (change < 1e-7) { converged = true; break; }
    }
  }
  if (diagonalApproximation && !converged) converged = theta.every(Number.isFinite);
  let covariance = diagonalApproximation
    ? finalHessian.map((row, rowIndex) => row.map((value, columnIndex) => rowIndex === columnIndex ? 1 / Math.max(value, 1e-8) : 0))
    : inverse(finalHessian);
  let covarianceStable = Boolean(covariance);
  if (!covariance) covariance = Array.from({ length: itemIds.length }, (_, row) => Array.from({ length: itemIds.length }, (_, column) => row === column ? 0.25 : 0));
  let factor = cholesky(covariance);
  if (!factor) {
    covarianceStable = false;
    const adjusted = covariance.map((row, rowIndex) => row.map((value, columnIndex) => value + (rowIndex === columnIndex ? 1e-6 : 0)));
    factor = cholesky(adjusted) || Array.from({ length: itemIds.length }, (_, row) => Array.from({ length: itemIds.length }, (_, column) => row === column ? 0.5 : 0));
  }
  const random = randomGenerator(hashSeed(`component:${componentId}:${itemIds.join('|')}:${componentEvents.length}`));
  const samples: number[][] = [];
  const variances = itemIds.map((_, index) => covariance![index][index]);
  for (let draw = 0; draw < actualDraws; draw += 1) {
    const z = itemIds.map(() => normalRandom(random));
    const sample = diagonalApproximation
      ? theta.map((value, row) => value + Math.sqrt(Math.max(variances[row], 1e-8)) * z[row])
      : theta.map((value, row) => value + factor![row].reduce((sum, coefficient, column) => sum + coefficient * z[column], 0));
    samples.push(center(sample));
  }
  const medians = itemIds.map((_, itemIndex) => median(samples.map((sample) => sample[itemIndex])));
  const lows = itemIds.map((_, itemIndex) => quantile(samples.map((sample) => sample[itemIndex]).sort((a, b) => a - b), 0.025));
  const highs = itemIds.map((_, itemIndex) => quantile(samples.map((sample) => sample[itemIndex]).sort((a, b) => a - b), 0.975));
  const ranks = itemIds.map(() => [] as number[]);
  for (const sample of samples) [...sample.keys()].sort((left, right) => sample[right] - sample[left]).forEach((itemIndex, rankIndex) => ranks[itemIndex].push(rankIndex + 1));
  let logLoss = 0;
  for (const event of componentEvents) {
    const utilities = event.candidates.map((id) => medians[index.get(id)!]);
    const max = Math.max(...utilities); const weights = utilities.map((value) => Math.exp(value - max)); const total = weights.reduce((sum, value) => sum + value, 0);
    const chosenIndex = event.candidates.indexOf(event.chosen);
    logLoss -= Math.log(Math.max(1e-12, weights[chosenIndex] / total));
  }
  const status = converged && covarianceStable ? 'stable' : 'unstable';
  return {
    itemIds, samples, medians, lows, highs, ranks, variances, diagonalApproximation,
    diagnostics: { componentId, itemCount: itemIds.length, eventCount: componentEvents.length, converged, iterations, covarianceStable, posteriorDraws: actualDraws, meanLogLoss: componentEvents.length ? logLoss / componentEvents.length : 0, status }
  };
}

function pairKey(rowId: string, columnId: string): string { return `${rowId}¦${columnId}`; }
function logistic(value: number): number { return 1 / (1 + Math.exp(-value)); }
function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1; const x = Math.abs(value) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

export class PreferenceArenaAnalyzer {
  analyze(events: ChoiceEvent[], capability: ChoiceCapabilityResult, parseReport: ChoiceParseReport): PreferenceArenaResult {
    if (!events.length) return {
      status: 'history_not_available', method: 'regularized_plackett_luce_laplace', itemCategory: 'relics', generatedAt: Date.now(), capability, parseReport,
      events: [], items: {}, pairs: {}, ordering: [], orderings: { adaptive: [], arena: [], choiceRate: [], slotMean: [] }, slotLabels: [], slotStructure: {}, axisOrdering: {}, components: [], diagnostics: [], temporalMetadata: { firstEvent: null, lastEvent: null, numRuns: 0, gameVersions: [] }, warnings: parseReport.warnings
    };
    const graph = componentGraph(events);
    const fits = graph.components.map((items, componentId) => fitComponent(componentId, items, events));
    const fitByItem = new Map<string, { fit: ComponentFit; index: number }>();
    for (const fit of fits) fit.itemIds.forEach((id, index) => fitByItem.set(id, { fit, index }));
    const slotLabels = [...new Map(events.flatMap((event) => event.slots).filter((slot): slot is number | string => slot !== null).map((slot) => [String(slot), slot])).values()].sort((left, right) => typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right)));
    const items: Record<string, ArenaItemStats> = {};
    for (const id of graph.adjacency.keys()) {
      const offeredEvents = events.filter((event) => event.candidates.includes(id));
      const chosenEvents = offeredEvents.filter((event) => event.chosen === id);
      const outcomeEvents = chosenEvents.filter((event) => event.outcome !== null);
      const wins = outcomeEvents.filter((event) => event.outcome === 'win').length;
      const slotCounts = itemSlotCounts(id, offeredEvents, slotLabels);
      const slotProfile = smoothedProfile(slotCounts);
      const supportedSlots = slotLabels.filter((_, index) => slotCounts[index] > 0);
      const located = fitByItem.get(id)!;
      const rankValues = located.fit.ranks[located.index].sort((a, b) => a - b);
      items[id] = {
        id,
        slotCounts,
        slotProfile,
        slotSignature: `S${supportedSlots.join('')}`,
        slotMean: slotProfile.reduce((sum, value, index) => sum + value * (index + 1), 0),
        slotProfileStatus: slotProfileDrift(id, events, slotLabels),
        offered: offeredEvents.length,
        chosen: chosenEvents.length,
        choiceRate: offeredEvents.length ? chosenEvents.length / offeredEvents.length : 0,
        choiceCi: betaInterval(chosenEvents.length, offeredEvents.length, `choice:${id}`),
        outcomeChosen: outcomeEvents.length,
        chosenWins: wins,
        winRate: outcomeEvents.length ? wins / outcomeEvents.length : null,
        winCi: outcomeEvents.length ? betaInterval(wins, outcomeEvents.length, `win:${id}`) : null,
        componentId: located.fit.diagnostics.componentId,
        theta: located.fit.medians[located.index],
        thetaCi: [located.fit.lows[located.index], located.fit.highs[located.index]],
        rank: median(rankValues),
        rankCi: [quantile(rankValues, 0.025), quantile(rankValues, 0.975)]
      };
    }
    const pairs: Record<string, ArenaPairStats> = {};
    const ids = [...graph.adjacency.keys()];
    const empiricalPairs = new Map<string, { cooccurN: number; chosen: Map<string, number> }>();
    for (const event of events) for (let left = 0; left < event.candidates.length; left += 1) for (let right = left + 1; right < event.candidates.length; right += 1) {
      const key = [event.candidates[left], event.candidates[right]].sort().join('¦');
      const row = empiricalPairs.get(key) || { cooccurN: 0, chosen: new Map<string, number>() };
      row.cooccurN += 1;
      row.chosen.set(event.chosen, (row.chosen.get(event.chosen) || 0) + 1);
      empiricalPairs.set(key, row);
    }
    for (const rowId of ids) for (const columnId of ids) {
      if (rowId === columnId) continue;
      const sameComponent = graph.componentByItem.get(rowId) === graph.componentByItem.get(columnId);
      const unorderedKey = [rowId, columnId].sort().join('¦');
      const empirical = empiricalPairs.get(unorderedKey);
      const cooccurN = empirical?.cooccurN || 0;
      const relation: ArenaPairStats['relation'] = !sameComponent ? 'na' : cooccurN > 0 ? 'direct' : 'indirect';
      const commonNeighbors = [...(graph.adjacency.get(rowId) || [])].filter((neighbor) => graph.adjacency.get(columnId)?.has(neighbor)).length;
      let pref: number | null = null; let prefCi: [number, number] | null = null; let directionConfidence: number | null = null;
      if (sameComponent) {
        const row = fitByItem.get(rowId)!; const column = fitByItem.get(columnId)!;
        if (row.fit.diagonalApproximation) {
          const difference = row.fit.medians[row.index] - row.fit.medians[column.index];
          const deviation = Math.sqrt(Math.max(1e-8, row.fit.variances[row.index] + row.fit.variances[column.index]));
          pref = logistic(difference); prefCi = [logistic(difference - 1.96 * deviation), logistic(difference + 1.96 * deviation)]; directionConfidence = normalCdf(Math.abs(difference) / deviation);
        } else {
          const probabilities = row.fit.samples.map((sample) => logistic(sample[row.index] - sample[column.index])).sort((a, b) => a - b);
          pref = median(probabilities); prefCi = [quantile(probabilities, 0.025), quantile(probabilities, 0.975)];
          const above = probabilities.filter((value) => value > 0.5).length / probabilities.length;
          directionConfidence = Math.max(above, 1 - above);
        }
      }
      const rowCount = empirical?.chosen.get(rowId) || 0;
      const columnCount = empirical?.chosen.get(columnId) || 0;
      const thirdCount = cooccurN - rowCount - columnCount;
      pairs[pairKey(rowId, columnId)] = {
        rowId, columnId, relation, pref, prefCi, directionConfidence, cooccurN,
        rowChoiceCount: cooccurN ? rowCount : null,
        columnChoiceCount: cooccurN ? columnCount : null,
        thirdChoiceCount: cooccurN ? thirdCount : null,
        otherChoiceCount: cooccurN ? thirdCount : null,
        rowShare: cooccurN ? rowCount / cooccurN : null,
        columnShare: cooccurN ? columnCount / cooccurN : null,
        thirdShare: cooccurN ? thirdCount / cooccurN : null,
        otherShare: cooccurN ? thirdCount / cooccurN : null,
        commonNeighbors,
        shortestPath: sameComponent ? graph.distances.get(rowId)?.get(columnId) ?? null : null,
        componentId: sameComponent ? graph.componentByItem.get(rowId)! : null
      };
    }
    const componentSequence = fits.map((fit) => fit.diagnostics).sort((left, right) => right.eventCount - left.eventCount || right.itemCount - left.itemCount || graph.components[left.componentId].join('|').localeCompare(graph.components[right.componentId].join('|'))).map((row) => row.componentId);
    const slotStructure: Record<string, SlotStructureDiagnostics> = {};
    const axisOrdering: Record<string, AxisOrderingResult> = {};
    const adaptive: string[] = []; const arena: string[] = []; const choiceRate: string[] = []; const slotMean: string[] = [];
    for (const componentId of componentSequence) {
      const componentItems = [...graph.components[componentId]];
      const structure = slotStructureDiagnostics(componentId, componentItems, items);
      slotStructure[String(componentId)] = structure;
      const arenaOrder = [...componentItems].sort((left, right) => items[left].rank - items[right].rank || left.localeCompare(right));
      const order = structure.topologyEnabled ? topologyOrder(componentItems, items) : arenaOrder;
      const adjacentSlotDistance = order.slice(0, -1).map((id, index) => jensenShannon(items[id].slotProfile, items[order[index + 1]].slotProfile));
      axisOrdering[String(componentId)] = { componentId, order, mode: structure.topologyEnabled ? 'slot_topology' : 'arena_fallback', adjacentSlotDistance, separatorStrength: structure.topologyEnabled ? separatorStrength(adjacentSlotDistance) : adjacentSlotDistance.map(() => 1), orientation: 'early_to_late', diagnostics: { slotStructureP: structure.pValue, slotStructureEffect: structure.cramersV } };
      adaptive.push(...order);
      arena.push(...arenaOrder);
      choiceRate.push(...[...componentItems].sort((left, right) => items[right].choiceRate - items[left].choiceRate || items[left].rank - items[right].rank || left.localeCompare(right)));
      slotMean.push(...[...componentItems].sort((left, right) => items[left].slotMean - items[right].slotMean || items[left].rank - items[right].rank || left.localeCompare(right)));
    }
    const ordering = adaptive;
    const timestamps = events.flatMap((event) => event.timestamp === null ? [] : [event.timestamp]);
    const diagnostics = fits.map((fit) => fit.diagnostics);
    const unstable = diagnostics.some((row) => row.status === 'unstable');
    const warnings = [...parseReport.warnings];
    if (unstable) warnings.push('至少一个比较分量的 Laplace 后验诊断不稳定；请优先使用描述统计。');
    warnings.push('选择后胜率是历史关联，不是遗物的因果效果。');
    return {
      status: unstable ? 'unstable' : 'available', method: 'regularized_plackett_luce_laplace', itemCategory: 'relics', generatedAt: Date.now(), capability, parseReport,
      events, items, pairs, ordering, orderings: { adaptive, arena, choiceRate, slotMean }, slotLabels, slotStructure, axisOrdering,
      components: graph.components.map((itemIds, componentId) => ({ componentId, itemIds })), diagnostics,
      temporalMetadata: { firstEvent: timestamps.length ? Math.min(...timestamps) : null, lastEvent: timestamps.length ? Math.max(...timestamps) : null, numRuns: new Set(events.flatMap((event) => event.runId ? [event.runId] : [])).size, gameVersions: parseReport.gameVersions },
      warnings
    };
  }
}

export function analyzePreferenceArenaRuns(runs: NormalizedRunV2[], scope: PreferenceArenaScope = {}): PreferenceArenaResult {
  const source = scope.source || 'ancient';
  const normalized = source === 'card' ? new CardChoiceEventNormalizer().normalize(runs) : new AncientChoiceEventNormalizer().normalize(runs);
  const cardClassification = source === 'card' ? classifyCardAvailability(runs) : null;
  const colorless = new Set(cardClassification?.colorlessIds || []);
  let events = normalized.events.filter((event) => {
    if (source === 'ancient' && scope.ancientId && String(event.metadata.ancientId || '') !== scope.ancientId) return false;
    const character = scope.playerCharacter || (scope.cardCategory && !['all', 'colorless'].includes(scope.cardCategory) ? scope.cardCategory : undefined);
    if (character && String(event.metadata.playerCharacter || '') !== character) return false;
    if (scope.focusItemId && !event.candidates.includes(scope.focusItemId)) return false;
    return true;
  });
  if (source === 'card' && scope.cardCategory === 'colorless') events = events.flatMap((event) => {
    const candidates = event.candidates.filter((id) => colorless.has(id));
    if (candidates.length < 2 || !colorless.has(event.chosen)) return [];
    return [{ ...event, candidates, slots: candidates.map((_, index) => index + 1), metadata: { ...event.metadata, projectedColorlessChoiceSet: true } }];
  });
  const warnings = [...normalized.report.warnings];
  if (!events.length && (scope.ancientId || scope.playerCharacter)) warnings.push('当前对象与角色视角下没有可用的三选一历史。');
  if (source === 'card' && scope.cardCategory === 'colorless') warnings.push(`无色卡由各角色实际提供分布自动识别：${colorless.size} 张；Arena 仅使用至少同时出现 2 张无色卡、且最终选中无色卡的记录。`);
  const capability: ChoiceCapabilityResult = {
    ...normalized.capability,
    status: events.length ? 'available' : 'history_not_available',
    canExtractChoiceHistory: events.length > 0,
    hasRunId: events.length > 0 && events.every((event) => Boolean(event.runId)),
    hasTimestamp: events.some((event) => event.timestamp !== null),
    hasOutcome: events.some((event) => event.outcome !== null),
    hasSlotInformation: events.length > 0 && events.every((event) => event.slots.every((slot) => slot !== null)),
    hasGameVersion: events.some((event) => Boolean(event.gameVersion)),
    warnings
  };
  const report: ChoiceParseReport = {
    ...normalized.report,
    eventsTotal: events.length,
    eventsValid: events.length,
    eventsRejected: 0,
    uniqueItems: new Set(events.flatMap((event) => event.candidates)).size,
    choiceSetSizes: Object.fromEntries([...events.reduce((map, event) => map.set(event.candidates.length, (map.get(event.candidates.length) || 0) + 1), new Map<number, number>())].map(([size, count]) => [String(size), count])),
    hasOutcome: capability.hasOutcome,
    hasTimestamp: capability.hasTimestamp,
    gameVersions: [...new Set(events.flatMap((event) => event.gameVersion ? [event.gameVersion] : []))].sort(),
    warnings
  };
  const analyzed = new PreferenceArenaAnalyzer().analyze(events, capability, report);
  if (source === 'card') analyzed.warnings = analyzed.warnings.map((warning) => warning === '选择后胜率是历史关联，不是遗物的因果效果。' ? '选择后胜率是历史关联，不是卡牌的因果效果。' : warning);
  return { ...analyzed, itemCategory: source === 'card' ? 'cards' : 'relics' };
}
