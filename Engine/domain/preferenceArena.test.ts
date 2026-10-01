import { describe, expect, it } from 'vitest';
import { analyzePreferenceArenaRuns, AncientChoiceEventNormalizer, CardChoiceEventNormalizer, classifyCardAvailability, PreferenceArenaAnalyzer, type ChoiceCapabilityResult, type ChoiceEvent, type ChoiceParseReport } from './preferenceArena';
import type { NormalizedRunV2 } from './types';

function event(id: string, candidates: string[], chosen: string, outcome: 'win' | 'loss' | null = null): ChoiceEvent {
  return { eventId: id, candidates, chosen, slots: candidates.map((_, index) => index + 1), runId: id, timestamp: null, outcome, gameVersion: null, metadata: {} };
}

function withSlots(id: string, candidates: string[], slots: number[], chosen = candidates[0]): ChoiceEvent {
  return { ...event(id, candidates, chosen), slots };
}

function context(events: ChoiceEvent[]) {
  const capability: ChoiceCapabilityResult = { status: events.length ? 'available' : 'history_not_available', canExtractChoiceHistory: events.length > 0, hasRunId: true, hasTimestamp: false, hasOutcome: events.some((row) => row.outcome !== null), hasSlotInformation: true, hasGameVersion: false, warnings: [] };
  const report: ChoiceParseReport = { parser: 'synthetic', parserVersion: '1', eventsTotal: events.length, eventsValid: events.length, eventsRejected: 0, uniqueItems: new Set(events.flatMap((row) => row.candidates)).size, choiceSetSizes: { '3': events.length }, hasOutcome: capability.hasOutcome, hasTimestamp: false, gameVersions: [], warnings: [] };
  return { capability, report };
}

describe('preference arena invariants', () => {
  it('rejects duplicated candidate identities during normalization', () => {
    const run = {
      id: 'invalid.run', startTime: 1, status: 'win', buildId: 'test', character: 'Silent',
      players: [{ character: 'Silent' }],
      timeline: [{ floor: 1, act: 1, ancientChoices: [{ relicId: 'A', chosen: false }, { relicId: 'A', chosen: false }, { relicId: 'C', chosen: true }] }]
    } as unknown as NormalizedRunV2;
    const normalized = new AncientChoiceEventNormalizer().normalize([run]);
    expect(normalized.events).toHaveLength(0);
    expect(normalized.report.eventsRejected).toBe(1);
    expect(normalized.capability.status).toBe('history_not_available');
  });

  it('derives direct, indirect and disconnected relations without hard-coded item identities', () => {
    const events = [
      event('one', ['A', 'C', 'X'], 'A', 'win'),
      event('two', ['B', 'C', 'Y'], 'B', 'loss'),
      event('three', ['D', 'E', 'F'], 'D', 'win'),
      event('four', ['A', 'C', 'Z'], 'C', 'loss')
    ];
    const { capability, report } = context(events);
    const result = new PreferenceArenaAnalyzer().analyze(events, capability, report);
    const ac = result.pairs['A¦C'];
    const ab = result.pairs['A¦B'];
    const ad = result.pairs['A¦D'];
    const ba = result.pairs['B¦A'];

    expect(ac).toMatchObject({ relation: 'direct', cooccurN: 2 });
    expect((ac.rowShare || 0) + (ac.columnShare || 0) + (ac.thirdShare || 0)).toBeCloseTo(1, 12);
    expect(ab).toMatchObject({ relation: 'indirect', cooccurN: 0, shortestPath: 2 });
    expect(ad).toMatchObject({ relation: 'na', pref: null, shortestPath: null });
    expect((ab.pref || 0) + (ba.pref || 0)).toBeCloseTo(1, 10);
    expect(result.items.Z).toMatchObject({ offered: 1, chosen: 0, winRate: null });
    expect(result.components).toHaveLength(2);
  });

  it('keeps choice analysis available when outcomes are absent', () => {
    const events = [event('one', ['R1', 'R2', 'R3'], 'R2')];
    const { capability, report } = context(events);
    const result = new PreferenceArenaAnalyzer().analyze(events, capability, report);
    expect(result.status).toBe('available');
    expect(result.items.R2.winRate).toBeNull();
    expect(result.items.R2.choiceRate).toBe(1);
  });

  it('scopes the arena to one ancient object and one player character', () => {
    const run = {
      id: 'scoped.run', startTime: 1, status: 'win', buildId: 'test', character: 'Silent',
      players: [{ character: 'Silent' }, { character: 'Ironclad' }],
      playerTimelines: [
        [{ floor: 1, act: 1, ancientId: 'EVENT.NEOW', label: 'EVENT.NEOW', ancientChoices: [{ relicId: 'N1', chosen: true }, { relicId: 'N2' }, { relicId: 'N3' }] }],
        [{ floor: 1, act: 1, ancientId: 'EVENT.PAEL', label: 'EVENT.PAEL', ancientChoices: [{ relicId: 'P1', chosen: true }, { relicId: 'P2' }, { relicId: 'P3' }] }]
      ]
    } as unknown as NormalizedRunV2;
    const result = analyzePreferenceArenaRuns([run], { ancientId: 'EVENT.NEOW', playerCharacter: 'Silent' });
    expect(result.events).toHaveLength(1);
    expect(result.ordering).toEqual(expect.arrayContaining(['RELIC.N1', 'RELIC.N2', 'RELIC.N3']));
    expect(result.ordering).not.toContain('RELIC.P1');
  });

  it('falls back to arena rank when every item has the same slot distribution', () => {
    const candidates = ['A', 'B', 'C'];
    const events = Array.from({ length: 60 }, (_, index) => {
      const rotated = [...candidates.slice(index % 3), ...candidates.slice(0, index % 3)];
      return withSlots(`shared-${index}`, rotated, [1, 2, 3], rotated[index % rotated.length]);
    });
    const { capability, report } = context(events);
    const result = new PreferenceArenaAnalyzer().analyze(events, capability, report);
    expect(result.slotStructure['0'].topologyEnabled).toBe(false);
    expect(result.axisOrdering['0'].mode).toBe('arena_fallback');
    expect(result.items.A.slotProfile.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  it('learns strict slot regions without a fixed pool count', () => {
    const events = Array.from({ length: 96 }, (_, index) => withSlots(`strict-${index}`, [`A${index % 2}`, `B${Math.floor(index / 2) % 2}`, `C${Math.floor(index / 4) % 2}`], [1, 2, 3]));
    const { capability, report } = context(events);
    const result = new PreferenceArenaAnalyzer().analyze(events, capability, report);
    const order = result.axisOrdering['0'].order;
    const contiguous = (prefix: string) => { const positions = order.map((id, index) => id.startsWith(prefix) ? index : -1).filter((index) => index >= 0); return Math.max(...positions) - Math.min(...positions) === positions.length - 1; };
    expect(result.slotStructure['0'].topologyEnabled).toBe(true);
    expect(result.axisOrdering['0'].mode).toBe('slot_topology');
    expect(contiguous('A')).toBe(true);
    expect(contiguous('B')).toBe(true);
    expect(contiguous('C')).toBe(true);
  });

  it('supports four slots and shrinks a new one-observation item profile', () => {
    const events = [withSlots('four', ['Q1', 'Q2', 'Q3', 'Q4'], [1, 2, 3, 4])];
    const { capability, report } = context(events);
    const result = new PreferenceArenaAnalyzer().analyze(events, capability, report);
    expect(result.slotLabels).toEqual([1, 2, 3, 4]);
    expect(result.items.Q1.slotCounts).toEqual([1, 0, 0, 0]);
    expect(result.items.Q1.slotProfile[0]).toBeLessThan(1);
    expect(result.items.Q1.slotProfile.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  it('identifies shared colorless cards from balanced five-character exposure without card-name rules', () => {
    const characters = ['Ironclad', 'Silent', 'Regent', 'Necrobinder', 'Defect'];
    const runs = characters.map((character, characterIndex) => ({
      id: `run-${character}`, startTime: characterIndex + 1, status: 'win', buildId: 'test', character,
      players: [{ character }],
      playerTimelines: [[...Array.from({ length: 5 }, (_, index) => ({ floor: index + 1, cardChoices: [{ id: 'CARD.SHARED', picked: true }, { id: `CARD.${character}`, picked: false }] }))]]
    })) as unknown as NormalizedRunV2[];
    const classification = classifyCardAvailability(runs);
    expect(classification.colorlessIds).toContain('CARD.SHARED');
    expect(classification.colorlessIds).not.toContain('CARD.Ironclad');
  });

  it('keeps the same card as separate observations in different character arenas', () => {
    const run = {
      id: 'coop-card.run', startTime: 1, status: 'win', buildId: 'test', character: 'Silent',
      players: [{ character: 'Silent' }, { character: 'Ironclad' }],
      playerTimelines: [
        [{ floor: 2, cardChoices: [{ id: 'CARD.SHARED', picked: true }, { id: 'CARD.SILENT_ONLY' }, { id: 'CARD.X' }] }],
        [{ floor: 2, cardChoices: [{ id: 'CARD.SHARED' }, { id: 'CARD.IRONCLAD_ONLY', picked: true }, { id: 'CARD.Y' }] }]
      ]
    } as unknown as NormalizedRunV2;
    const silent = analyzePreferenceArenaRuns([run], { source: 'card', cardCategory: 'Silent' });
    const ironclad = analyzePreferenceArenaRuns([run], { source: 'card', cardCategory: 'Ironclad' });
    expect(silent.items['CARD.SHARED']).toMatchObject({ offered: 1, chosen: 1 });
    expect(ironclad.items['CARD.SHARED']).toMatchObject({ offered: 1, chosen: 0 });
    expect(silent.items['CARD.IRONCLAD_ONLY']).toBeUndefined();
    expect(ironclad.items['CARD.SILENT_ONLY']).toBeUndefined();
  });

  it('rejects multi-pick card records instead of silently keeping only the first pick', () => {
    const run = {
      id: 'multi-pick.run', startTime: 1, status: 'win', buildId: 'test', character: 'Silent',
      players: [{ character: 'Silent' }],
      playerTimelines: [[{ floor: 2, act: 1, cardChoices: [{ id: 'CARD.A', picked: true }, { id: 'CARD.B', picked: true }, { id: 'CARD.C', picked: false }] }]]
    } as unknown as NormalizedRunV2;
    const normalized = new CardChoiceEventNormalizer().normalize([run]);
    expect(normalized.events).toHaveLength(0);
    expect(normalized.report.eventsRejected).toBe(1);
    expect(normalized.report.warnings.join(' ')).toContain('包含 2 张被选卡');
  });
});
