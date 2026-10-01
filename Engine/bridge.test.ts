import { describe, expect, it } from 'vitest';
import { dispatch } from './bridge';
import { normalizeRun } from './domain/parser';
import { EMPTY_FILTER } from './domain/schemas';
import { executeQuery, executeCareerQuery, matchesFilter } from './domain/query';
import type { QuerySpec } from './domain/types';

function run(id: string, win = true, coop = false) {
  const value = normalizeRun({
    win, ascension: 0, run_time: 600, start_time: 100,
    players: Array.from({ length: coop ? 2 : 1 }, (_, index) => ({ id: index, character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.STRIKE_IRONCLAD' }], relics: [] })),
    map_point_history: []
  }, `${id}.run`);
  return { ...value, id, startTime: Number(id) || 1 };
}
function call(op: string, extra = {}) { return JSON.parse(dispatch(JSON.stringify({ op, ...extra }))); }
const query: QuerySpec = { id: 'scope', dataSource: 'runs', metricIds: ['wins', 'losses'], dimensionIds: [], filter: EMPTY_FILTER, sort: [], limit: 50, visualization: 'table' };
const solo = { ...run('1'), totalDamageTaken: 0, deckSize: 5 };
const loss = { ...run('2', false), totalDamageTaken: 30 };
const secondWin = { ...run('3'), totalDamageTaken: 0, deckSize: 9 };
const coop = { ...run('4', true, true), totalDamageTaken: 900, deckSize: 100 };
const inconsistentCoop = { ...coop, id: '5', isMultiplayer: false };
const mixed = [solo, loss, secondWin, coop, inconsistentCoop];
function stable(value: unknown) { return JSON.parse(JSON.stringify(value, (key, item) => key === 'generatedAt' ? 0 : item)); }
function load() { call('load', { runs: mixed, progress: { characterStats: [{ character: 'Ironclad', wins: 9999, losses: 8888 }], totalPlaytime: 999999 } }); }

describe('rest analysis scope', () => {
  it('uses filtered solo records and leaves the loaded dataset unchanged', () => {
    const withRest = (id: string, character: string, ascension: number, coop = false) => {
      const value = normalizeRun({
        win: true, ascension, run_time: 600, start_time: 100,
        players: Array.from({ length: coop ? 2 : 1 }, (_, index) => ({ id: index + 1, character, deck: [], relics: [] })),
        map_point_history: [[
          { map_point_type: 'monster', player_stats: [{ player_id: 1, current_hp: 20, max_hp: 80 }] },
          { map_point_type: 'rest', player_stats: [{ player_id: 1, current_hp: 44, max_hp: 80, rest_site_choices: ['HEAL'] }] },
          { map_point_type: 'elite', player_stats: [{ player_id: 1, current_hp: 30, max_hp: 80 }] },
          { map_point_type: 'rest', player_stats: [{ player_id: 1, current_hp: 30, max_hp: 80, rest_site_choices: ['SMITH'] }] }
        ]]
      }, `${id}.run`);
      return { ...value, id };
    };
    const first = withRest('rest-ironclad', 'CHARACTER.IRONCLAD', 0);
    const second = withRest('rest-silent', 'CHARACTER.SILENT', 10);
    const multiplayer = withRest('rest-coop', 'CHARACTER.IRONCLAD', 0, true);
    call('load', { runs: [first, second, multiplayer] });
    const before = call('run', { id: first.id });
    const result = call('restAnalysis');
    expect(result).toMatchObject({ runCount: 2, siteCount: 4, hpSamples: 4, completeIntervals: 2, censoredIntervals: 2 });
    expect(call('restAnalysis', { filter: { party: 'coop' } })).toEqual(result);
    expect(call('restAnalysis', { filter: { characters: ['Ironclad'] } })).toMatchObject({ runCount: 1, siteCount: 2 });
    expect(call('restAnalysis', { filter: { ascensions: [10] } })).toMatchObject({ runCount: 1, siteCount: 2 });
    expect(call('restAnalysis', { filter: { characters: ['Defect'] } })).toMatchObject({ runCount: 0, siteCount: 0, choices: [] });
    expect(call('run', { id: first.id })).toEqual(before);
  });
});

describe('single-player statistics boundary', () => {
  it('keeps dashboard and career independent of mixed progress and party overrides', () => {
    load();
    for (const party of ['all', 'solo', 'coop']) {
      const dashboard = call('dashboard', { filter: { party } });
      expect(dashboard.summary).toMatchObject({ total: 3, wins: 2, winRate: 2 / 3, avgDamageTaken: 10, maxWinStreak: 1, minWinningDeckSize: 5, maxWinningDeckSize: 9 });
      expect(dashboard.damage).toBeUndefined();
      expect(dashboard.insights).toBeUndefined();
      expect(call('career', { filter: { party } })).toMatchObject({ source: 'solo-runs', totalPlaytime: 1800, summary: { total: 3, wins: 2 } });
      expect(call('runs', { filter: { party } }).map((r: any) => r.id)).toEqual(['3', '2', '1']);
      expect(call('coop', { filter: { party } }).runs.map((r: any) => r.id)).toEqual(['4', '5']);
    }
    expect(call('career', { filter: { characters: ['Silent'] }, focus: { kind: 'run', id: '4' } }).summary.total).toBe(3);
    expect(call('run', { id: '4' }).id).toBe('4');
    expect(call('run', { id: '1' }).id).toBe('1');
  });

  it('cannot widen direct queries, career queries, or cohorts to multiplayer', () => {
    load();
    for (const dataSource of ['runs', 'career', 'players'] as const) {
      const q = { ...query, dataSource, filter: { ...EMPTY_FILTER, party: 'coop' as const }, cohorts: [{ id: 'A' as const, name: 'A', filter: { ...EMPTY_FILTER, party: 'coop' as const } }] };
      for (const result of [executeQuery(mixed as any, q), executeCareerQuery(mixed as any, q), call('query', { query: q, filter: { party: 'coop' } })]) {
        expect(result.sample.eligible).toBe(3);
        expect(result.rows[0].values).toMatchObject({ wins: 2, losses: 1 });
        expect(result.rows[0].drilldownIds.sort()).toEqual(['1', '2', '3']);
      }
    }
    expect(matchesFilter(inconsistentCoop as any, { ...EMPTY_FILTER, party: 'solo' })).toBe(false);
    expect(matchesFilter(inconsistentCoop as any, { ...EMPTY_FILTER, party: 'coop' })).toBe(true);
  });

  it('applies solo scope to every advanced object entry point', () => {
    load();
    const operations = [
      { op: 'arena' }, { op: 'archetypes', character: 'Ironclad' },
      { op: 'entity', kind: 'card', id: 'CARD.STRIKE_IRONCLAD' },
      { op: 'entity', kind: 'relic', id: 'RELIC.BURNING_BLOOD' },
      { op: 'entity', kind: 'encounter', id: 'ENCOUNTER.TEST' },
      { op: 'ancients' }, { op: 'ancient', id: 'ANCIENT.TEST' }
    ];
    const mixedResults = operations.map(({ op, ...extra }) => call(op, { ...extra, filter: { party: 'coop' } }));
    call('load', { runs: [solo, loss, secondWin], progress: null });
    operations.forEach(({ op, ...extra }, index) => expect(stable(call(op, extra))).toEqual(stable(mixedResults[index])));
  });

  it('breaks longest streak on abandonment and preserves empty winning extrema', () => {
    const abandoned = { ...run('2', false), status: 'abandoned', totalDamageTaken: 0 };
    call('load', { runs: [solo, abandoned, secondWin, { ...secondWin, id: '6', startTime: 6 }], progress: null });
    expect(call('dashboard').characters[0].maxWinStreak).toBe(2);
    expect(call('dashboard').rolling.map((point: any) => point.value)).toEqual([1, 1, 1]);
    call('load', { runs: [abandoned], progress: null });
    expect(call('dashboard').rolling).toEqual([]);
    expect(call('dashboard').summary.currentStreak).toBe(0);
    call('load', { runs: [loss], progress: null });
    expect(call('dashboard').summary).toMatchObject({ minWinningDeckSize: null, maxWinningDeckSize: null });
    call('load', { runs: [], progress: null });
    expect(call('career').summary).toMatchObject({ total: 0, avgDamageTaken: 0, maxWinStreak: 0 });
  });
});
