import { describe, expect, it } from 'vitest';
import { normalizeRun } from './parser';
import { EMPTY_FILTER } from './schemas';
import { executeQuery } from './query';
import { zhCharacter } from './i18n';
import type { NormalizedRunV2, QuerySpec } from './types';

function run(file: string, win: boolean, character: string, scope: 'history' | 'imported' = 'history') {
  const value = normalizeRun({
    win,
    ascension: 10,
    build_id: 'v0.112.0',
    game_mode: 'standard',
    run_time: 1800,
    start_time: file.charCodeAt(0) * 100,
    players: [{ id: 1, character: `CHARACTER.${character.toUpperCase()}`, deck: [{ id: 'CARD.A' }], relics: [] }],
    map_point_history: []
  }, `${file}.run`) as unknown as NormalizedRunV2;
  value.sourceScope = scope;
  return value;
}

const baseQuery: QuerySpec = { id: 'test', dataSource: 'runs', metricIds: ['sample', 'win_rate'], dimensionIds: ['character'], filter: EMPTY_FILTER, sort: [], limit: 50, visualization: 'table' };

describe('QuerySpec engine', () => {
  it('isolates imported records from personal history by default', () => {
    const result = executeQuery([run('a', true, 'SILENT'), run('b', false, 'SILENT'), run('c', true, 'DEFECT', 'imported')], baseQuery);
    expect(result.sample.eligible).toBe(2);
    expect(result.rows[0].values.win_rate).toBe(.5);
    expect(result.rows[0].items).toEqual([{ kind: 'character', id: 'Silent', label: zhCharacter('Silent') }]);
  });

  it('preserves every atomic item in a composite analysis row', () => {
    const result = executeQuery([run('a', true, 'SILENT')], { ...baseQuery, dimensionIds: ['build', 'ascension'] });
    expect(result.rows[0].items).toEqual([
      { kind: 'build', id: 'v0.112.0', label: 'v0.112.0' },
      { kind: 'ascension', id: '10', label: 'A10' }
    ]);
  });

  it('keeps A/B cohort filters independent and finite', () => {
    const result = executeQuery([run('a', true, 'SILENT'), run('b', false, 'DEFECT')], {
      ...baseQuery,
      dimensionIds: [],
      cohorts: [
        { id: 'A', name: 'A', filter: { ...EMPTY_FILTER, characters: ['Silent'] } },
        { id: 'B', name: 'B', filter: { ...EMPTY_FILTER, characters: ['Defect'] } }
      ]
    });
    expect(result.rows.find((row) => row.cohort === 'A')?.values.win_rate).toBe(1);
    expect(result.rows.find((row) => row.cohort === 'B')?.values.win_rate).toBe(0);
    expect(result.sample.eligible).toBe(2);
    expect(result.reliability).toBe('limited');
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('does not turn conflicting base and cohort filters into a wildcard', () => {
    const result = executeQuery([run('a', true, 'SILENT'), run('b', false, 'DEFECT')], {
      ...baseQuery,
      dimensionIds: [],
      filter: { ...EMPTY_FILTER, characters: ['Silent'] },
      cohorts: [{ id: 'A', name: 'A', filter: { ...EMPTY_FILTER, characters: ['Defect'] } }]
    });
    expect(result.rows[0]?.sample || 0).toBe(0);
  });

  it('keeps relic offers, picks and final possession as separate metrics', () => {
    const value = run('a', true, 'SILENT');
    value.timeline = [{ floor: 5, act: 1, actFloor: 5, type: 'elite', label: 'ENCOUNTER.X', hp: 60, maxHp: 70, gold: 100, damageTaken: 0, hpHealed: 0, goldGained: 0, goldSpent: 0, relicChoices: [{ id: 'RELIC.A', picked: true }] }];
    value.relics = [{ id: 'RELIC.A', floorAdded: 5 }];
    value.players[0].relics = value.relics;
    value.relicEvents = ['RELIC.A'];
    const result = executeQuery([value], { ...baseQuery, dataSource: 'relics', metricIds: ['offered', 'picked', 'pick_rate', 'runs_with', 'win_rate_with'], dimensionIds: ['entity'] });
    expect(result.rows[0].values).toMatchObject({ offered: 1, picked: 1, pick_rate: 1, runs_with: 1, win_rate_with: 1 });
  });

  it('counts every card candidate as offered when calculating pick rate', () => {
    const value = run('a', true, 'SILENT');
    value.cardChoices = [
      { floor: 2, offered: ['CARD.A', 'CARD.B'], picked: 'CARD.A' },
      { floor: 3, offered: ['CARD.A', 'CARD.C'], picked: null }
    ];
    const result = executeQuery([value], {
      ...baseQuery,
      dataSource: 'cards',
      metricIds: ['sample', 'offered', 'picked', 'pick_rate'],
      dimensionIds: ['entity']
    });
    const cardA = result.rows.find((row) => row.key === 'CARD.A');
    expect(cardA?.sample).toBe(2);
    expect(cardA?.values).toMatchObject({ offered: 2, picked: 1, pick_rate: .5 });
  });

  it('preserves atomic multi-pick and duplicate candidate flags from the timeline', () => {
    const value = run('a', true, 'SILENT');
    value.timeline = [{
      floor: 2, act: 1, actFloor: 2, type: 'monster', label: 'ENCOUNTER.X', hp: 60, maxHp: 70, gold: 100,
      damageTaken: 0, hpHealed: 0, goldGained: 0, goldSpent: 0,
      cardChoices: [{ id: 'CARD.A', picked: true }, { id: 'CARD.B', picked: true }, { id: 'CARD.A', picked: false }]
    }];
    const result = executeQuery([value], {
      ...baseQuery,
      dataSource: 'cards',
      metricIds: ['offered', 'picked', 'pick_rate'],
      dimensionIds: ['entity']
    });
    expect(result.rows.find((row) => row.key === 'CARD.A')?.values).toMatchObject({ offered: 2, picked: 1, pick_rate: .5 });
    expect(result.rows.find((row) => row.key === 'CARD.B')?.values).toMatchObject({ offered: 1, picked: 1, pick_rate: 1 });
  });

  it('shrinks choice rates and keeps their interval separate from selected-run outcomes', () => {
    const winner = run('a', true, 'SILENT');
    winner.cardChoices = [{ floor: 2, offered: ['CARD.A', 'CARD.B'], picked: 'CARD.B' }];
    const loser = run('b', false, 'SILENT');
    loser.cardChoices = [{ floor: 2, offered: ['CARD.A', 'CARD.B'], picked: 'CARD.A' }];
    const result = executeQuery([winner, loser], {
      ...baseQuery,
      dataSource: 'cards',
      metricIds: ['pick_rate', 'adjusted_pick_rate', 'pick_ci_low', 'pick_ci_high', 'adjusted_win_rate', 'ci_low', 'ci_high'],
      dimensionIds: ['entity']
    });
    const cardA = result.rows.find((row) => row.key === 'CARD.A');
    expect(cardA?.values.pick_rate).toBe(.5);
    expect(cardA?.values.adjusted_pick_rate).toBe(.5);
    expect(Number(cardA?.values.pick_ci_low)).toBeGreaterThan(0);
    expect(Number(cardA?.values.pick_ci_high)).toBeLessThan(1);
    expect(cardA?.values.adjusted_win_rate).toBeCloseTo(5 / 11, 12);
    expect(cardA?.values.ci_low).toBe(0);
    expect(Number(cardA?.values.ci_high)).toBeCloseTo(.7934567085261071, 12);
  });

  it('groups floor observations by room type with reusable share metrics', () => {
    const value = run('a', true, 'SILENT');
    const point = (floor: number, type: string) => ({ floor, act: 1, actFloor: floor, type, label: type, hp: 60, maxHp: 70, gold: 100, damageTaken: 0, hpHealed: 0, goldGained: 0, goldSpent: 0 });
    value.timeline = [point(1, 'monster'), point(2, 'monster'), point(3, 'shop')];
    value.playerTimelines = [value.timeline];
    const result = executeQuery([value], { ...baseQuery, dataSource: 'floors', metricIds: ['share'], dimensionIds: ['room_type'], sort: [{ field: 'share', direction: 'desc' }] });
    expect(result.rows.map((row) => [row.key, row.values.share, row.items[0]?.kind])).toEqual([
      ['monster', 2 / 3, 'roomType'],
      ['shop', 1 / 3, 'roomType']
    ]);
  });

  it('supports server-side focus without exposing or pre-filtering run arrays', () => {
    const first = run('a', true, 'SILENT');
    const second = run('b', false, 'SILENT');
    second.deck = [{ id: 'CARD.B', floorAdded: 0, upgradeLevel: 0 }];
    second.players[0].deck = second.deck;
    const result = executeQuery([first, second], { ...baseQuery, metricIds: ['sample'], dimensionIds: [], focus: { kind: 'card', id: 'CARD.A' } });
    expect(result.sample.eligible).toBe(1);
    expect(result.rows[0]?.sample).toBe(1);
  });
});
