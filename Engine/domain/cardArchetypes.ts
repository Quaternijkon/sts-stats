import type { NormalizedCard, NormalizedRunV2, RunStatus, TimelinePoint } from './types.js';

export type ArchetypeEvidenceMode = 'conditional_pick' | 'acquisition_sequence' | 'co_deck';
export type ArchetypeStatus = 'available' | 'no_structure' | 'insufficient_data';

export interface CardArchetypeConfig {
  minCardOffers: number;
  minCardPicks: number;
  minExposuresPerSide: number;
  minPairSupport: number;
  minAffinityEffect: number;
  minPosteriorProbability: number;
  minClusterStability: number;
  bootstrapSamples: number;
  maxAtlasCards: number;
}

export const DEFAULT_CARD_ARCHETYPE_CONFIG: CardArchetypeConfig = {
  minCardOffers: 10,
  minCardPicks: 2,
  minExposuresPerSide: 5,
  minPairSupport: 10,
  minAffinityEffect: 0.35,
  minPosteriorProbability: 0.95,
  minClusterStability: 0.62,
  bootstrapSamples: 12,
  maxAtlasCards: 72
};

export interface ArchetypeDirectionalAffinity {
  source: string;
  target: string;
  sourcePresentTargetOffers: number;
  sourceAbsentTargetOffers: number;
  sourcePresentTargetPicks: number;
  sourceAbsentTargetPicks: number;
  affinity: number | null;
  affinityCi: [number, number] | null;
  probPositive: number | null;
  probNegative: number | null;
  posteriorSd: number | null;
  status: 'available' | 'insufficient_contrast' | 'co_deck';
}

export interface ArchetypePairAffinity {
  id: string;
  left: string;
  right: string;
  affinity: number | null;
  affinityCi: [number, number] | null;
  directionalDifference: number | null;
  positiveSupport: number | null;
  negativeSupport: number | null;
  effectiveSupport: number;
  edgeVisible: boolean;
  clusterEligible: boolean;
  leftToRight: ArchetypeDirectionalAffinity;
  rightToLeft: ArchetypeDirectionalAffinity;
}

export interface ArchetypeCardStat {
  id: string;
  offers: number | null;
  picks: number;
  baselinePickRate: number | null;
  runsPresent: number;
  copiesAcquired: number;
  evidenceStatus: 'analyzed' | 'insufficient' | 'starter';
  dominantArchetype: string | null;
  membership: Record<string, number>;
  specialization: number | null;
  bridgeScore: number | null;
  coreScore: number | null;
  x: number;
  y: number;
}

export interface ArchetypeCommunity {
  id: string;
  members: string[];
  coreCards: string[];
  bridgeCards: string[];
  stability: number;
  cohesion: number;
  totalEvidence: number;
  dominantRunCount: number;
  historicalWinRate: number | null;
}

export interface ArchetypeRunComposition {
  runId: string;
  originalRunId: string;
  timestamp: number;
  buildId: string;
  status: RunStatus;
  floor: number;
  membership: Record<string, number>;
  dominantArchetype: string | null;
  analyzedCards: number;
}

export interface CardArchetypeAnalysisResult {
  characterId: string;
  evidenceMode: ArchetypeEvidenceMode;
  status: ArchetypeStatus;
  cards: Record<string, ArchetypeCardStat>;
  cardOrder: string[];
  insufficientCards: string[];
  starterCards: string[];
  pairs: Record<string, ArchetypePairAffinity>;
  visibleEdges: string[];
  communities: ArchetypeCommunity[];
  matrixOrder: string[];
  runComposition: ArchetypeRunComposition[];
  diagnostics: {
    perspectiveRuns: number;
    choiceEvents: number;
    acquisitionEvents: number;
    rejectedChoiceEvents: number;
    analyzedCards: number;
    insufficientCards: number;
    builds: string[];
    versionDriftCompared: boolean;
    changedPairCount: number;
    warnings: string[];
  };
  config: CardArchetypeConfig;
}

interface ChoiceEvent {
  runId: string;
  candidates: string[];
  chosen: string | null;
  deckBefore: Set<string>;
  floor: number;
}

interface AcquisitionEvent {
  runId: string;
  acquired: string;
  deckBefore: Set<string>;
  floor: number;
}

interface PerspectiveRun {
  id: string;
  originalRunId: string;
  timestamp: number;
  buildId: string;
  status: RunStatus;
  floor: number;
  finalDeck: string[];
  initialDeck: Set<string>;
  choiceEvents: ChoiceEvent[];
  acquisitionEvents: AcquisitionEvent[];
}

interface PairEstimate {
  mean: number;
  sd: number;
  ci: [number, number];
  probPositive: number;
}

const pairId = (left: string, right: string) => [left, right].sort().join('¦');
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function cardIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => typeof entry === 'string' ? entry : String((entry as { id?: unknown })?.id || '')).filter(Boolean) : [];
}

function addCount(counts: Map<string, number>, id: string, amount = 1) {
  const next = (counts.get(id) || 0) + amount;
  if (next <= 0) counts.delete(id); else counts.set(id, next);
}

function pointGains(point: TimelinePoint): string[] {
  const gains = cardIds(point.cardsGained);
  const picked = (Array.isArray(point.cardChoices) ? point.cardChoices : [])
    .filter((choice) => Boolean((choice as { picked?: unknown }).picked))
    .map((choice) => String((choice as { id?: unknown }).id || '')).filter(Boolean);
  for (const id of picked) if (!gains.includes(id)) gains.push(id);
  return gains;
}

function pointTransforms(point: TimelinePoint): Array<{ from: string; to: string }> {
  return (Array.isArray(point.cardsTransformed) ? point.cardsTransformed : []).flatMap((entry) => {
    const value = entry as { from?: { id?: unknown } | string; to?: { id?: unknown } | string };
    const from = typeof value.from === 'string' ? value.from : String(value.from?.id || '');
    const to = typeof value.to === 'string' ? value.to : String(value.to?.id || '');
    return from || to ? [{ from, to }] : [];
  });
}

function deriveInitialDeck(finalDeck: string[], timeline: TimelinePoint[]): Map<string, number> {
  const counts = new Map<string, number>();
  finalDeck.forEach((id) => addCount(counts, id));
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const point = timeline[index];
    for (const transform of [...pointTransforms(point)].reverse()) {
      if (transform.to) addCount(counts, transform.to, -1);
      if (transform.from) addCount(counts, transform.from);
    }
    for (const id of cardIds(point.cardsRemoved)) addCount(counts, id);
    for (const id of pointGains(point)) addCount(counts, id, -1);
  }
  return counts;
}

function applyPoint(deck: Map<string, number>, point: TimelinePoint) {
  for (const id of pointGains(point)) addCount(deck, id);
  for (const id of cardIds(point.cardsRemoved)) addCount(deck, id, -1);
  for (const transform of pointTransforms(point)) {
    if (transform.from) addCount(deck, transform.from, -1);
    if (transform.to) addCount(deck, transform.to);
  }
}

function normalizePerspectiveRun(run: NormalizedRunV2, playerIndex: number, characterId: string): PerspectiveRun | null {
  const player = run.players[playerIndex] || run.players[0];
  const character = player?.character || run.character;
  if (character !== characterId) return null;
  const timeline = (run.playerTimelines?.[playerIndex] || (playerIndex === 0 ? run.timeline : []) || []) as TimelinePoint[];
  const finalDeck = (player?.deck || (playerIndex === 0 ? run.deck : []) || []).map((card: NormalizedCard) => String(card.id || '')).filter(Boolean);
  const initialCounts = deriveInitialDeck(finalDeck, timeline);
  const deck = new Map(initialCounts);
  const choiceEvents: ChoiceEvent[] = [];
  const acquisitionEvents: AcquisitionEvent[] = [];

  for (const point of timeline) {
    const deckBefore = new Set(deck.keys());
    const choices = Array.isArray(point.cardChoices) ? point.cardChoices as Array<{ id?: unknown; picked?: unknown }> : [];
    if (choices.length) {
      const candidates = [...new Set(choices.map((choice) => String(choice.id || '')).filter(Boolean))];
      const picked = choices.filter((choice) => Boolean(choice.picked)).map((choice) => String(choice.id || '')).filter(Boolean);
      if (candidates.length === choices.length && picked.length <= 1) {
        choiceEvents.push({ runId: `${run.id}:player-${playerIndex}`, candidates, chosen: picked[0] || null, deckBefore: new Set(deckBefore), floor: Number(point.floor || 0) });
      }
    }
    const gains = pointGains(point);
    for (const acquired of gains) acquisitionEvents.push({ runId: `${run.id}:player-${playerIndex}`, acquired, deckBefore: new Set(deckBefore), floor: Number(point.floor || 0) });
    applyPoint(deck, point);
  }

  return {
    id: `${run.id}:player-${playerIndex}`,
    originalRunId: String(run.originalRunId || run.id),
    timestamp: run.startTime,
    buildId: run.buildId || 'unknown',
    status: run.status,
    floor: run.floor,
    finalDeck,
    initialDeck: new Set(initialCounts.keys()),
    choiceEvents,
    acquisitionEvents
  };
}

function perspectiveRuns(runs: NormalizedRunV2[], characterId: string): { runs: PerspectiveRun[]; rejected: number } {
  const output: PerspectiveRun[] = [];
  let rejected = 0;
  for (const run of runs) {
    const timelines = run.playerTimelines?.length ? run.playerTimelines : [run.timeline || []];
    for (let playerIndex = 0; playerIndex < timelines.length; playerIndex += 1) {
      const before = output.length;
      const normalized = normalizePerspectiveRun(run, playerIndex, characterId);
      if (normalized) output.push(normalized);
      if (normalized) {
        const rawGroups = (timelines[playerIndex] || []).filter((point) => Array.isArray(point.cardChoices) && point.cardChoices.length).length;
        rejected += Math.max(0, rawGroups - normalized.choiceEvents.length);
      }
      if (before === output.length && !run.players[playerIndex] && playerIndex > 0) rejected += 1;
    }
  }
  return { runs: output, rejected };
}

export function cardArchetypeCharacters(runs: NormalizedRunV2[]): string[] {
  const preferred = ['Ironclad', 'Silent', 'Regent', 'Necrobinder', 'Defect', 'Watcher'];
  const found = new Set(runs.flatMap((run) => (run.players.length ? run.players : [{ character: run.character }]).map((player) => player.character)).filter((character) => character && character !== 'Unknown'));
  return [...found].sort((left, right) => {
    const leftIndex = preferred.indexOf(left); const rightIndex = preferred.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    return left.localeCompare(right);
  });
}

function digamma(value: number): number {
  let x = value; let result = 0;
  while (x < 7) { result -= 1 / x; x += 1; }
  const inverse = 1 / x; const inverse2 = inverse * inverse;
  return result + Math.log(x) - inverse / 2 - inverse2 * (1 / 12 - inverse2 * (1 / 120 - inverse2 / 252));
}

function trigamma(value: number): number {
  let x = value; let result = 0;
  while (x < 7) { result += 1 / (x * x); x += 1; }
  const inverse = 1 / x; const inverse2 = inverse * inverse;
  return result + inverse + inverse2 / 2 + inverse2 * inverse / 6 - inverse2 * inverse2 * inverse / 30 + inverse2 * inverse2 * inverse2 * inverse / 42;
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1; const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value: number): number { return 0.5 * (1 + erf(value / Math.SQRT2)); }

function posteriorEstimate(a: number, b: number, c: number, d: number): PairEstimate {
  const ap = a + 0.5; const bp = b + 0.5; const cp = c + 0.5; const dp = d + 0.5;
  const mean = digamma(ap) - digamma(bp) - digamma(cp) + digamma(dp);
  const variance = trigamma(ap) + trigamma(bp) + trigamma(cp) + trigamma(dp);
  const sd = Math.sqrt(Math.max(1e-9, variance));
  return { mean, sd, ci: [mean - 1.96 * sd, mean + 1.96 * sd], probPositive: normalCdf(mean / sd) };
}

function emptyDirectional(source: string, target: string, status: ArchetypeDirectionalAffinity['status'] = 'insufficient_contrast'): ArchetypeDirectionalAffinity {
  return { source, target, sourcePresentTargetOffers: 0, sourceAbsentTargetOffers: 0, sourcePresentTargetPicks: 0, sourceAbsentTargetPicks: 0, affinity: null, affinityCi: null, probPositive: null, probNegative: null, posteriorSd: null, status };
}

function directionalFromEvents(source: string, target: string, events: Array<{ item: string; picked: boolean; deckBefore: Set<string> }>, config: CardArchetypeConfig): ArchetypeDirectionalAffinity {
  let a = 0; let b = 0; let c = 0; let d = 0;
  for (const event of events) {
    if (event.item !== target) continue;
    const present = event.deckBefore.has(source);
    if (present && event.picked) a += 1;
    else if (present) b += 1;
    else if (event.picked) c += 1;
    else d += 1;
  }
  const base = { source, target, sourcePresentTargetOffers: a + b, sourceAbsentTargetOffers: c + d, sourcePresentTargetPicks: a, sourceAbsentTargetPicks: c };
  if (a + b < config.minExposuresPerSide || c + d < config.minExposuresPerSide) return { ...emptyDirectional(source, target), ...base };
  const estimate = posteriorEstimate(a, b, c, d);
  return { ...base, affinity: estimate.mean, affinityCi: estimate.ci, probPositive: estimate.probPositive, probNegative: 1 - estimate.probPositive, posteriorSd: estimate.sd, status: 'available' };
}

function coDeckDirectional(source: string, target: string, runs: PerspectiveRun[]): ArchetypeDirectionalAffinity {
  let a = 0; let b = 0; let c = 0; let d = 0;
  for (const run of runs) {
    const deck = new Set(run.finalDeck);
    if (deck.has(source) && deck.has(target)) a += 1;
    else if (deck.has(source)) b += 1;
    else if (deck.has(target)) c += 1;
    else d += 1;
  }
  const estimate = posteriorEstimate(a, b, c, d);
  return { source, target, sourcePresentTargetOffers: a + b, sourceAbsentTargetOffers: c + d, sourcePresentTargetPicks: a, sourceAbsentTargetPicks: c, affinity: estimate.mean, affinityCi: estimate.ci, probPositive: estimate.probPositive, probNegative: 1 - estimate.probPositive, posteriorSd: estimate.sd, status: 'co_deck' };
}

function combineDirectional(left: string, right: string, leftToRight: ArchetypeDirectionalAffinity, rightToLeft: ArchetypeDirectionalAffinity, config: CardArchetypeConfig): ArchetypePairAffinity {
  const id = pairId(left, right);
  if (leftToRight.affinity === null || rightToLeft.affinity === null || leftToRight.posteriorSd === null || rightToLeft.posteriorSd === null) {
    return { id, left, right, affinity: null, affinityCi: null, directionalDifference: leftToRight.affinity !== null && rightToLeft.affinity !== null ? leftToRight.affinity - rightToLeft.affinity : null, positiveSupport: null, negativeSupport: null, effectiveSupport: 0, edgeVisible: false, clusterEligible: false, leftToRight, rightToLeft };
  }
  const leftWeight = 1 / Math.max(1e-9, leftToRight.posteriorSd ** 2); const rightWeight = 1 / Math.max(1e-9, rightToLeft.posteriorSd ** 2);
  const affinity = (leftToRight.affinity * leftWeight + rightToLeft.affinity * rightWeight) / (leftWeight + rightWeight);
  const sd = Math.sqrt(1 / (leftWeight + rightWeight));
  const positiveSupport = normalCdf(affinity / sd);
  const effectiveSupport = Math.min(leftToRight.sourcePresentTargetOffers + leftToRight.sourceAbsentTargetOffers, rightToLeft.sourcePresentTargetOffers + rightToLeft.sourceAbsentTargetOffers);
  const clusterEligible = affinity > 0 && positiveSupport >= 0.8 && effectiveSupport >= config.minPairSupport;
  const edgeVisible = affinity > config.minAffinityEffect && positiveSupport >= config.minPosteriorProbability && effectiveSupport >= config.minPairSupport;
  return { id, left, right, affinity, affinityCi: [affinity - 1.96 * sd, affinity + 1.96 * sd], directionalDifference: leftToRight.affinity - rightToLeft.affinity, positiveSupport, negativeSupport: 1 - positiveSupport, effectiveSupport, edgeVisible, clusterEligible, leftToRight, rightToLeft };
}

function buildPairMap(runs: PerspectiveRun[], universe: string[], mode: ArchetypeEvidenceMode, config: CardArchetypeConfig): Record<string, ArchetypePairAffinity> {
  const pairs: Record<string, ArchetypePairAffinity> = {};
  const conditionalEvents = runs.flatMap((run) => run.choiceEvents.flatMap((event) => event.candidates.map((item) => ({ item, picked: event.chosen === item, deckBefore: event.deckBefore }))));
  const sequenceEvents = runs.flatMap((run) => run.acquisitionEvents.map((event) => ({ item: event.acquired, picked: true, deckBefore: event.deckBefore })));
  let modelEvents = conditionalEvents;
  if (mode === 'acquisition_sequence') {
    const targets = new Set(universe);
    modelEvents = sequenceEvents.flatMap((event) => [{ ...event }, ...[...targets].filter((target) => target !== event.item).map((target) => ({ item: target, picked: false, deckBefore: event.deckBefore }))]);
  }
  for (let leftIndex = 0; leftIndex < universe.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < universe.length; rightIndex += 1) {
    const left = universe[leftIndex]; const right = universe[rightIndex];
    const leftToRight = mode === 'co_deck' ? coDeckDirectional(left, right, runs) : directionalFromEvents(left, right, modelEvents, config);
    const rightToLeft = mode === 'co_deck' ? coDeckDirectional(right, left, runs) : directionalFromEvents(right, left, modelEvents, config);
    pairs[pairId(left, right)] = combineDirectional(left, right, leftToRight, rightToLeft, config);
  }
  return pairs;
}

function graphWeights(ids: string[], pairs: Record<string, ArchetypePairAffinity>): Map<string, Map<string, number>> {
  const graph = new Map(ids.map((id) => [id, new Map<string, number>()]));
  for (const pair of Object.values(pairs)) if (pair.clusterEligible && pair.affinity !== null) {
    graph.get(pair.left)?.set(pair.right, pair.affinity);
    graph.get(pair.right)?.set(pair.left, pair.affinity);
  }
  return graph;
}

function detectCommunities(ids: string[], pairs: Record<string, ArchetypePairAffinity>): string[][] {
  const graph = graphWeights(ids, pairs);
  const community = new Map(ids.map((id) => [id, id]));
  const degree = new Map(ids.map((id) => [id, [...(graph.get(id)?.values() || [])].reduce((sum, value) => sum + value, 0)]));
  const totalDegree = [...degree.values()].reduce((sum, value) => sum + value, 0);
  if (totalDegree <= 0) return ids.map((id) => [id]);
  const totals = new Map(ids.map((id) => [id, degree.get(id) || 0]));
  for (let iteration = 0; iteration < 40; iteration += 1) {
    let moved = false;
    for (const id of [...ids].sort()) {
      const current = community.get(id)!; const nodeDegree = degree.get(id) || 0;
      totals.set(current, (totals.get(current) || 0) - nodeDegree);
      const byCommunity = new Map<string, number>();
      for (const [neighbor, weight] of graph.get(id) || []) {
        const targetCommunity = community.get(neighbor)!;
        byCommunity.set(targetCommunity, (byCommunity.get(targetCommunity) || 0) + weight);
      }
      byCommunity.set(current, byCommunity.get(current) || 0);
      let best = current; let bestScore = -Infinity;
      for (const [candidate, internalWeight] of [...byCommunity.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const score = internalWeight - nodeDegree * (totals.get(candidate) || 0) / totalDegree;
        if (score > bestScore + 1e-10) { best = candidate; bestScore = score; }
      }
      community.set(id, best); totals.set(best, (totals.get(best) || 0) + nodeDegree);
      if (best !== current) moved = true;
    }
    if (!moved) break;
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) { const key = community.get(id)!; groups.set(key, [...(groups.get(key) || []), id]); }
  return [...groups.values()].map((members) => members.sort());
}

function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (const character of seedText) { seed ^= character.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return () => { seed += 0x6D2B79F5; let value = seed; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

function bootstrapStability(runs: PerspectiveRun[], universe: string[], mode: ArchetypeEvidenceMode, originalGroups: string[][], config: CardArchetypeConfig, characterId: string): Map<string, number> {
  const score = new Map<string, number>();
  if (runs.length < 4 || config.bootstrapSamples <= 0) return score;
  const coassigned = new Map<string, number>(); const random = seededRandom(`archetype:${characterId}:${runs.length}`);
  for (let draw = 0; draw < config.bootstrapSamples; draw += 1) {
    const sample = Array.from({ length: runs.length }, () => runs[Math.floor(random() * runs.length)]);
    const pairs = buildPairMap(sample, universe, mode, config);
    const groups = detectCommunities(universe, pairs);
    const assignment = new Map<string, number>(); groups.forEach((members, index) => members.forEach((id) => assignment.set(id, index)));
    for (const group of originalGroups) for (let left = 0; left < group.length; left += 1) for (let right = left + 1; right < group.length; right += 1) {
      const key = pairId(group[left], group[right]);
      if (assignment.get(group[left]) === assignment.get(group[right])) coassigned.set(key, (coassigned.get(key) || 0) + 1);
    }
  }
  for (const group of originalGroups) {
    const keys: string[] = [];
    for (let left = 0; left < group.length; left += 1) for (let right = left + 1; right < group.length; right += 1) keys.push(pairId(group[left], group[right]));
    score.set(group.join('¦'), keys.length ? keys.reduce((sum, key) => sum + (coassigned.get(key) || 0) / config.bootstrapSamples, 0) / keys.length : 0);
  }
  return score;
}

function communityLabel(index: number): string {
  let value = index + 1; let label = '';
  while (value > 0) { value -= 1; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return `Archetype ${label}`;
}

function layoutCards(cards: Record<string, ArchetypeCardStat>, pairs: Record<string, ArchetypePairAffinity>, communities: ArchetypeCommunity[]) {
  const ids = Object.keys(cards); if (!ids.length) return;
  const centers = new Map<string, { x: number; y: number }>();
  communities.forEach((community, index) => {
    const angle = communities.length <= 1 ? 0 : index / communities.length * Math.PI * 2 - Math.PI / 2;
    centers.set(community.id, { x: 0.5 + Math.cos(angle) * 0.27, y: 0.5 + Math.sin(angle) * 0.25 });
  });
  ids.sort().forEach((id, index) => {
    const card = cards[id]; const center = card.dominantArchetype ? centers.get(card.dominantArchetype) : null;
    const angle = index * 2.399963229728653;
    card.x = (center?.x ?? 0.5) + Math.cos(angle) * (center ? 0.075 : 0.31);
    card.y = (center?.y ?? 0.5) + Math.sin(angle) * (center ? 0.07 : 0.28);
  });
  const positive = Object.values(pairs).filter((pair) => pair.clusterEligible && pair.affinity !== null);
  for (let iteration = 0; iteration < 180; iteration += 1) {
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) {
      const a = cards[ids[left]]; const b = cards[ids[right]]; let dx = a.x - b.x; let dy = a.y - b.y;
      const distance2 = Math.max(0.001, dx * dx + dy * dy); const strength = 0.000045 / distance2;
      dx *= strength; dy *= strength; force.get(a.id)!.x += dx; force.get(a.id)!.y += dy; force.get(b.id)!.x -= dx; force.get(b.id)!.y -= dy;
    }
    for (const pair of positive) {
      const a = cards[pair.left]; const b = cards[pair.right]; if (!a || !b) continue;
      const dx = b.x - a.x; const dy = b.y - a.y; const attraction = 0.008 * Math.min(2.5, pair.affinity || 0);
      force.get(a.id)!.x += dx * attraction; force.get(a.id)!.y += dy * attraction; force.get(b.id)!.x -= dx * attraction; force.get(b.id)!.y -= dy * attraction;
    }
    for (const id of ids) {
      const card = cards[id]; const home = card.dominantArchetype ? centers.get(card.dominantArchetype) : null;
      if (home) { force.get(id)!.x += (home.x - card.x) * 0.002; force.get(id)!.y += (home.y - card.y) * 0.002; }
      card.x = clamp(card.x + force.get(id)!.x, 0.04, 0.96); card.y = clamp(card.y + force.get(id)!.y, 0.06, 0.94);
    }
  }
}

function analyzeVersionDrift(runs: PerspectiveRun[], universe: string[], mode: ArchetypeEvidenceMode, config: CardArchetypeConfig): { compared: boolean; changed: number } {
  const byBuild = new Map<string, PerspectiveRun[]>();
  for (const run of runs) byBuild.set(run.buildId, [...(byBuild.get(run.buildId) || []), run]);
  const builds = [...byBuild.entries()].filter(([, values]) => values.length >= Math.max(8, config.minPairSupport)).sort((left, right) => right[1].length - left[1].length);
  if (builds.length < 2) return { compared: false, changed: 0 };
  const leftPairs = buildPairMap(builds[0][1], universe, mode, config); const rightPairs = buildPairMap(builds[1][1], universe, mode, config);
  let changed = 0;
  for (const id of Object.keys(leftPairs)) {
    const left = leftPairs[id].affinity; const right = rightPairs[id].affinity;
    if (left !== null && right !== null && Math.abs(left - right) >= 1.5) changed += 1;
  }
  return { compared: true, changed };
}

export function analyzeCardArchetypes(runsInput: NormalizedRunV2[], characterId: string, overrides: Partial<CardArchetypeConfig> = {}): CardArchetypeAnalysisResult {
  if (!characterId) throw new Error('character_id is required');
  const config = { ...DEFAULT_CARD_ARCHETYPE_CONFIG, ...overrides };
  const normalized = perspectiveRuns(runsInput, characterId);
  const runs = normalized.runs;
  const choiceEvents = runs.flatMap((run) => run.choiceEvents);
  const acquisitionEvents = runs.flatMap((run) => run.acquisitionEvents);
  const mode: ArchetypeEvidenceMode = choiceEvents.length ? 'conditional_pick' : acquisitionEvents.length ? 'acquisition_sequence' : 'co_deck';
  const allIds = new Set<string>(); const offers = new Map<string, number>(); const picks = new Map<string, number>(); const runsPresent = new Map<string, number>(); const copies = new Map<string, number>();
  for (const run of runs) {
    for (const id of new Set(run.finalDeck)) { allIds.add(id); runsPresent.set(id, (runsPresent.get(id) || 0) + 1); }
    for (const id of run.finalDeck) copies.set(id, (copies.get(id) || 0) + 1);
  }
  if (mode === 'conditional_pick') for (const event of choiceEvents) {
    for (const id of event.candidates) { allIds.add(id); offers.set(id, (offers.get(id) || 0) + 1); }
    if (event.chosen) { picks.set(event.chosen, (picks.get(event.chosen) || 0) + 1); allIds.add(event.chosen); }
  }
  if (mode === 'acquisition_sequence') for (const event of acquisitionEvents) { allIds.add(event.acquired); picks.set(event.acquired, (picks.get(event.acquired) || 0) + 1); }
  if (mode === 'co_deck') for (const id of allIds) picks.set(id, runsPresent.get(id) || 0);

  const starterCards = [...allIds].filter((id) => runs.length > 0 && runs.every((run) => run.initialDeck.has(id))).sort();
  const starterSet = new Set(starterCards);
  const eligibleCandidates = [...allIds].filter((id) => {
    if (starterSet.has(id)) return false;
    if (mode === 'conditional_pick') return (offers.get(id) || 0) >= config.minCardOffers && (picks.get(id) || 0) >= config.minCardPicks;
    return (picks.get(id) || 0) >= config.minCardPicks;
  }).sort((left, right) => (picks.get(right) || 0) - (picks.get(left) || 0) || left.localeCompare(right));
  const eligible = eligibleCandidates.slice(0, config.maxAtlasCards);
  const universe = [...eligible].sort();
  const eligibleSet = new Set(universe);
  const insufficientCards = [...allIds].filter((id) => !eligibleSet.has(id) && !starterSet.has(id)).sort();
  const pairs = buildPairMap(runs, universe, mode, config);
  const rawGroups = detectCommunities(universe, pairs).filter((members) => members.length >= 2);
  const stability = bootstrapStability(runs, universe, mode, rawGroups, config, characterId);
  const supportFor = (id: string) => picks.get(id) || runsPresent.get(id) || 0;
  rawGroups.sort((left, right) => right.reduce((sum, id) => sum + supportFor(id), 0) - left.reduce((sum, id) => sum + supportFor(id), 0) || left[0].localeCompare(right[0]));
  const communityByCard = new Map<string, string>();
  rawGroups.forEach((members, index) => members.forEach((id) => communityByCard.set(id, communityLabel(index))));
  const cards: Record<string, ArchetypeCardStat> = {};
  for (const id of universe) cards[id] = { id, offers: mode === 'conditional_pick' ? offers.get(id) || 0 : null, picks: picks.get(id) || 0, baselinePickRate: mode === 'conditional_pick' ? (picks.get(id) || 0) / Math.max(1, offers.get(id) || 0) : null, runsPresent: runsPresent.get(id) || 0, copiesAcquired: copies.get(id) || 0, evidenceStatus: 'analyzed', dominantArchetype: null, membership: {}, specialization: null, bridgeScore: null, coreScore: null, x: 0.5, y: 0.5 };
  const provisionalCommunities = rawGroups.map((members, index) => ({ id: communityLabel(index), members }));
  for (const id of universe) {
    const strength = new Map(provisionalCommunities.map((community) => [community.id, 0]));
    for (const other of universe) {
      if (other === id) continue; const pair = pairs[pairId(id, other)]; if (!pair || pair.affinity === null || pair.affinity <= 0) continue;
      const targetCommunity = communityByCard.get(other); if (targetCommunity) strength.set(targetCommunity, (strength.get(targetCommunity) || 0) + pair.affinity);
    }
    const total = [...strength.values()].reduce((sum, value) => sum + value, 0);
    const membership = Object.fromEntries([...strength.entries()].map(([key, value]) => [key, total ? value / total : 0]));
    const dominant = [...Object.entries(membership)].sort((left, right) => right[1] - left[1])[0];
    cards[id].membership = membership; cards[id].dominantArchetype = dominant && dominant[1] > 0 ? dominant[0] : communityByCard.get(id) || null;
    const positive = Object.values(membership).filter((value) => value > 0); const communityCount = provisionalCommunities.length;
    const entropy = positive.reduce((sum, value) => sum - value * Math.log(value), 0);
    cards[id].specialization = communityCount > 1 ? clamp(1 - entropy / Math.log(communityCount), 0, 1) : 1;
    const crossStrength = [...strength.entries()].filter(([community]) => community !== cards[id].dominantArchetype).reduce((sum, [, value]) => sum + value, 0);
    cards[id].bridgeScore = (1 - (cards[id].specialization || 0)) * crossStrength;
  }
  const communities: ArchetypeCommunity[] = provisionalCommunities.map((community) => {
    let internal = 0; let possible = 0;
    for (let left = 0; left < community.members.length; left += 1) for (let right = left + 1; right < community.members.length; right += 1) {
      const pair = pairs[pairId(community.members[left], community.members[right])]; if (pair?.affinity !== null) { possible += 1; internal += Math.max(0, pair.affinity); }
    }
    for (const id of community.members) {
      const within = community.members.filter((other) => other !== id).reduce((sum, other) => sum + Math.max(0, pairs[pairId(id, other)]?.affinity || 0), 0);
      cards[id].coreScore = (cards[id].membership[community.id] || (cards[id].dominantArchetype === community.id ? 1 : 0)) * within * Math.log1p(supportFor(id));
    }
    return { id: community.id, members: community.members, coreCards: [...community.members].sort((left, right) => (cards[right].coreScore || 0) - (cards[left].coreScore || 0) || left.localeCompare(right)).slice(0, 5), bridgeCards: [...universe].filter((id) => cards[id].dominantArchetype === community.id).sort((left, right) => (cards[right].bridgeScore || 0) - (cards[left].bridgeScore || 0)).slice(0, 3), stability: stability.get(community.members.join('¦')) ?? 0, cohesion: possible ? internal / possible : 0, totalEvidence: community.members.reduce((sum, id) => sum + supportFor(id), 0), dominantRunCount: 0, historicalWinRate: null };
  });
  layoutCards(cards, pairs, communities);
  const runComposition: ArchetypeRunComposition[] = runs.map((run) => {
    const totals = Object.fromEntries(communities.map((community) => [community.id, 0])) as Record<string, number>;
    let analyzedCards = 0;
    for (const id of run.finalDeck) if (cards[id]) { analyzedCards += 1; for (const [community, value] of Object.entries(cards[id].membership)) totals[community] = (totals[community] || 0) + value; }
    if (analyzedCards) for (const community of Object.keys(totals)) totals[community] /= analyzedCards;
    const dominant = [...Object.entries(totals)].sort((left, right) => right[1] - left[1])[0];
    return { runId: run.id, originalRunId: run.originalRunId, timestamp: run.timestamp, buildId: run.buildId, status: run.status, floor: run.floor, membership: totals, dominantArchetype: dominant && dominant[1] > 0 ? dominant[0] : null, analyzedCards };
  }).sort((left, right) => right.timestamp - left.timestamp);
  for (const community of communities) {
    const dominantRuns = runComposition.filter((run) => run.dominantArchetype === community.id && run.status !== 'abandoned');
    community.dominantRunCount = dominantRuns.length;
    community.historicalWinRate = dominantRuns.length ? dominantRuns.filter((run) => run.status === 'win').length / dominantRuns.length : null;
  }
  const stableCommunities = communities.filter((community) => community.stability >= config.minClusterStability);
  const visibleEdges = Object.values(pairs).filter((pair) => pair.edgeVisible).map((pair) => pair.id);
  const status: ArchetypeStatus = universe.length < 2 ? 'insufficient_data' : stableCommunities.length >= 2 && visibleEdges.length >= 2 ? 'available' : 'no_structure';
  const matrixOrder = [...universe].sort((left, right) => {
    const leftCommunity = communities.findIndex((community) => community.members.includes(left)); const rightCommunity = communities.findIndex((community) => community.members.includes(right));
    return (leftCommunity < 0 ? 999 : leftCommunity) - (rightCommunity < 0 ? 999 : rightCommunity) || (cards[right].coreScore || 0) - (cards[left].coreScore || 0) || left.localeCompare(right);
  });
  const drift = universe.length >= 2 ? analyzeVersionDrift(runs, universe, mode, config) : { compared: false, changed: 0 };
  const warnings: string[] = [];
  if (mode === 'acquisition_sequence') warnings.push('缺少完整候选记录；关系表示已有某牌后，后续取得目标牌的序列关联，不能解释为“被提供时更倾向抓”。');
  if (mode === 'co_deck') warnings.push('缺少抓牌历史；当前仅展示带收缩的终局同牌组关联，证据等级较低。');
  if (status === 'no_structure') warnings.push('当前阈值下没有检测到至少两个稳定流派；系统未强行切分聚类。');
  if (drift.changed > 0) warnings.push(`不同版本之间有 ${drift.changed} 对卡牌关系出现明显变化，合并解释时需谨慎。`);
  if (eligibleCandidates.length > config.maxAtlasCards) warnings.push(`主图只保留证据量最高的 ${config.maxAtlasCards} 张卡牌；其余卡牌列入 Insufficient Data。`);
  return { characterId, evidenceMode: mode, status, cards, cardOrder: universe, insufficientCards, starterCards, pairs, visibleEdges, communities, matrixOrder, runComposition, diagnostics: { perspectiveRuns: runs.length, choiceEvents: choiceEvents.length, acquisitionEvents: acquisitionEvents.length, rejectedChoiceEvents: normalized.rejected, analyzedCards: universe.length, insufficientCards: insufficientCards.length, builds: [...new Set(runs.map((run) => run.buildId))].sort(), versionDriftCompared: drift.compared, changedPairCount: drift.changed, warnings }, config };
}
