import type { NormalizedRunV2 } from './types.js';
import type { ObjectObservation } from './objectTypes.js';
import { gameCharacters } from './game.js';

export type CardPool = string;
export function cardPoolCharacters(): string[] { return [...gameCharacters()]; }
export function cardPoolIDs(): string[] { return [...cardPoolCharacters(), 'colorless', 'unknown']; }
export const CARD_POOL_RULES = {
  minCharacterRuns: 5, minOwnerObservations: 5, dominantShare: 0.8,
  minSharedObservations: 10, minSharedCharacters: 3, minSharedPerCharacter: 2, maxSharedShare: 0.6
} as const;

// Bump algorithm when evidence selection or ownership semantics change.
export const CARD_POOL_CACHE_VERSION = JSON.stringify({ algorithm: 2, rules: CARD_POOL_RULES });
export function readCardPoolCache(value: unknown): Map<string, CardPool> | null {
  if (!value || typeof value !== 'object') return null;
  const cache = value as { version?: unknown; assignments?: unknown };
  if (cache.version !== CARD_POOL_CACHE_VERSION || !cache.assignments || typeof cache.assignments !== 'object' || Array.isArray(cache.assignments)) return null;
  const entries = Object.entries(cache.assignments);
  const allowed = new Set(cardPoolIDs());
  if (entries.length > 20000 || entries.some(([id, pool]) => id.length > 512 || typeof pool !== 'string' || pool.length > 512 || !allowed.has(pool))) return null;
  return new Map(entries as [string, CardPool][]);
}

// Empirical pool membership is fixed for the loaded archive, not recalculated
// after selecting a character, date, search or page. Count a card at most once
// per run so duplicate copies and overlapping acquisition/hold events cannot vote twice.
export function classifyObjectCardPools(runs: NormalizedRunV2[], observations: ObjectObservation[]): Map<string, CardPool> {
  const characters = cardPoolCharacters();
  const characterRuns = new Map<string, Set<string>>(characters.map(character => [character, new Set<string>()]));
  for (const run of runs) characterRuns.get(run.character)?.add(run.id);
  const evidence = new Map<string, Map<string, Set<string>>>();
  const events = new Set(['offered', 'picked', 'acquired', 'held']);
  for (const observation of observations) {
    if (observation.object.kind !== 'card' || !events.has(observation.event) || !characterRuns.get(observation.character)?.has(observation.run.id)) continue;
    const card = evidence.get(observation.object.id) || new Map<string, Set<string>>();
    const seen = card.get(observation.character) || new Set<string>();
    seen.add(observation.run.id);
    card.set(observation.character, seen);
    evidence.set(observation.object.id, card);
  }
  const eligible = characters.filter(character => characterRuns.get(character)!.size >= CARD_POOL_RULES.minCharacterRuns);
  const pools = new Map<string, CardPool>();
  for (const [id, card] of evidence) {
    // One-character archives cannot distinguish that character's cards from shared cards.
    if (eligible.length < 2) { pools.set(id, 'unknown'); continue; }
    const rates = eligible.map(character => ({
      character, count: card.get(character)?.size || 0,
      rate: (card.get(character)?.size || 0) / characterRuns.get(character)!.size
    })).sort((a, b) => b.rate - a.rate || a.character.localeCompare(b.character));
    const totalRate = rates.reduce((sum, row) => sum + row.rate, 0);
    const leader = rates[0];
    const share = totalRate > 0 ? leader.rate / totalRate : 0;
    if (leader.count >= CARD_POOL_RULES.minOwnerObservations && share >= CARD_POOL_RULES.dominantShare) {
      pools.set(id, leader.character);
    } else if (rates.reduce((sum, row) => sum + row.count, 0) >= CARD_POOL_RULES.minSharedObservations
      && rates.filter(row => row.count >= CARD_POOL_RULES.minSharedPerCharacter).length >= CARD_POOL_RULES.minSharedCharacters
      && share <= CARD_POOL_RULES.maxSharedShare) {
      pools.set(id, 'colorless');
    } else { pools.set(id, 'unknown'); }
  }
  return pools;
}
