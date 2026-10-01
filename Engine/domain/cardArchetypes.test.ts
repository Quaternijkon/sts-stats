import { describe, expect, it } from 'vitest';
import { analyzeCardArchetypes } from './cardArchetypes';
import type { NormalizedRunV2 } from './types';

let sequence = 0;

function choiceRun(character: string, source: string | null, target: string, picked: boolean): NormalizedRunV2 {
  sequence += 1;
  const id = `${character}-${sequence}`;
  const initialDeck = source ? [{ id: source, floorAdded: 0, upgradeLevel: 0 }] : [];
  const gained = picked ? [{ id: target, floorAdded: 1, upgradeLevel: 0 }] : [];
  const finalDeck = [...initialDeck, ...gained];
  return {
    id, originalRunId: id, sourceScope: 'history', character, startTime: sequence, buildId: 'test', status: picked ? 'win' : 'loss', win: picked,
    players: [{ id: 1, character, deck: finalDeck, relics: [], potions: [], badges: [], maxPotionSlots: 0 }],
    playerTimelines: [[{ floor: 1, act: 1, actFloor: 1, type: 'monster', label: 'test', hp: 1, maxHp: 1, gold: 0, damageTaken: 0, hpHealed: 0, goldGained: 0, goldSpent: 0, cardsGained: gained, cardsRemoved: [], cardsTransformed: [], cardChoices: [{ id: target, picked }, { id: `FILLER.${id}`, picked: false }] }]],
    timeline: [], deck: finalDeck, deckSize: finalDeck.length, floor: 1, cardChoices: [], relics: [], relicCount: 0, encounterEvents: [], relicEvents: []
  } as unknown as NormalizedRunV2;
}

function directedEvidence(character: string, source: string, target: string, strong: boolean, repetitions = 4): NormalizedRunV2[] {
  const runs: NormalizedRunV2[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    runs.push(choiceRun(character, source, target, strong ? true : index % 2 === 0));
    runs.push(choiceRun(character, null, target, strong ? false : index % 2 === 0));
  }
  return runs;
}

const testConfig = {
  minCardOffers: 6,
  minCardPicks: 2,
  minExposuresPerSide: 3,
  minPairSupport: 8,
  minAffinityEffect: 0.2,
  minPosteriorProbability: 0.9,
  minClusterStability: 0,
  bootstrapSamples: 0,
  maxAtlasCards: 30
};

describe('card archetype analysis', () => {
  it('discovers two behavior-defined communities without a fixed cluster count', () => {
    const runs: NormalizedRunV2[] = [];
    for (const group of [['A', 'B', 'C'], ['D', 'E', 'F']]) {
      for (const source of group) for (const target of group) if (source !== target) runs.push(...directedEvidence('Ironclad', source, target, true));
    }
    const result = analyzeCardArchetypes(runs, 'Ironclad', testConfig);
    const communitySets = result.communities.map((community) => new Set(community.members));
    expect(result.evidenceMode).toBe('conditional_pick');
    expect(result.status).toBe('available');
    expect(communitySets).toHaveLength(2);
    expect(communitySets.some((members) => ['A', 'B', 'C'].every((id) => members.has(id)))).toBe(true);
    expect(communitySets.some((members) => ['D', 'E', 'F'].every((id) => members.has(id)))).toBe(true);
  });

  it('keeps a universally popular target out of the graph center when conditional affinity is neutral', () => {
    const runs = [
      ...directedEvidence('Silent', 'A', 'B', true, 5),
      ...directedEvidence('Silent', 'B', 'A', true, 5),
      ...directedEvidence('Silent', 'A', 'U', false, 5),
      ...directedEvidence('Silent', 'B', 'U', false, 5)
    ];
    const result = analyzeCardArchetypes(runs, 'Silent', testConfig);
    expect(result.cards.U.picks).toBeGreaterThan(0);
    expect(result.visibleEdges).toContain('A¦B');
    expect(result.visibleEdges.some((id) => id.includes('U'))).toBe(false);
  });

  it('preserves directional asymmetry in pair detail', () => {
    const runs = [
      ...directedEvidence('Regent', 'A', 'B', true, 6),
      ...directedEvidence('Regent', 'B', 'A', false, 6)
    ];
    const result = analyzeCardArchetypes(runs, 'Regent', testConfig);
    const pair = result.pairs['A¦B'];
    expect(pair.leftToRight.affinity).toBeGreaterThan(1);
    expect(Math.abs(pair.rightToLeft.affinity || 0)).toBeLessThan(0.25);
    expect(pair.directionalDifference).toBeGreaterThan(1);
  });

  it('allows no stable archetype instead of forcing a partition', () => {
    const runs = [
      ...directedEvidence('Necrobinder', 'A', 'B', false, 6),
      ...directedEvidence('Necrobinder', 'B', 'A', false, 6),
      ...directedEvidence('Necrobinder', 'C', 'D', false, 6),
      ...directedEvidence('Necrobinder', 'D', 'C', false, 6)
    ];
    const result = analyzeCardArchetypes(runs, 'Necrobinder', testConfig);
    expect(result.status).toBe('no_structure');
    expect(result.visibleEdges).toHaveLength(0);
  });

  it('filters by character before every statistic is calculated', () => {
    const ironcladRuns = [...directedEvidence('Ironclad', 'A', 'B', true, 6), ...directedEvidence('Ironclad', 'B', 'A', true, 6)];
    const silentRuns = [...directedEvidence('Silent', 'A', 'B', false, 20), ...directedEvidence('Silent', 'B', 'A', false, 20)];
    const isolated = analyzeCardArchetypes(ironcladRuns, 'Ironclad', testConfig);
    const mixedInput = analyzeCardArchetypes([...ironcladRuns, ...silentRuns], 'Ironclad', testConfig);
    expect(mixedInput.diagnostics.perspectiveRuns).toBe(ironcladRuns.length);
    expect(mixedInput.pairs['A¦B'].affinity).toBeCloseTo(isolated.pairs['A¦B'].affinity || 0, 12);
  });
});
