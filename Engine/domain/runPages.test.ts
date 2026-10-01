import { describe, expect, it } from 'vitest';
import { normalizeRun } from './parser';
import { coopSummary, playerTimeline, runPage } from './runPages';
import { zhCharacter } from './i18n';
import { setCurrentGame } from './game';
import type { NormalizedRunV2, TimelinePoint } from './types';

function run(id: string, extra: Partial<NormalizedRunV2> = {}): NormalizedRunV2 {
  return { ...normalizeRun({ win: true, start_time: 100, run_time: 600, seed: 'synthetic-seed', players: [{ id: 1, character: 'CHARACTER.IRONCLAD', deck: [], relics: [] }], map_point_history: [] }, id), ...extra };
}

describe('paged run analysis', () => {
  it('searches the complete native summary, raw IDs and localized display values', () => {
    setCurrentGame('sts2');
    const value = run('synthetic-name.run', { gameMode: 'custom', status: 'loss', win: false, character: 'Silent', players: [{ id: 1, character: 'Silent', deck: [], relics: [], potions: [], badges: [], maxPotionSlots: 3 }] });
    for (const search of ['synthetic-name', 'custom', 'loss', 'Silent', zhCharacter('Silent'), '失败']) {
      expect(runPage([value], { search }).runs.map(run => run.id)).toEqual([value.id]);
    }
    expect(runPage([value], { favorites: [] }).total).toBe(0);
    expect(runPage([value], { favorites: [value.id], search: 'absent' }).total).toBe(0);
  });

  it('ranks complete filtered columns before pagination and gives ties the same rank', () => {
    const pool = [run('a', { floor: 10 }), run('b', { floor: 10 }), run('c', { floor: 30 }), run('d', { floor: 40 })];
    const first = runPage(pool, { limit: 2, sort: { field: 'floor', direction: 'asc' } });
    const second = runPage(pool, { offset: 2, limit: 2, sort: { field: 'floor', direction: 'asc' } });
    expect(first.fills.a.floor).toBe(0);
    expect(first.fills.b.floor).toBe(0);
    expect(second.fills.c.floor).toBeCloseTo(2 / 3);
    expect(second.fills.d.floor).toBe(1);
    expect(first.heat.a.floor).toBe(0.25);
    expect(second.heat.d.floor).toBe(1);
    expect(runPage(pool, { favorites: ['c'], limit: -1 }).fills.c.floor).toBe(0);
    expect(pool.map(run => run.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('preserves normalized replay timelines without map records', () => {
    const timeline = [{ floor: 1, hp: 15, maxHp: 60, recordedFields: ['hp', 'maxHp'] }] as TimelinePoint[];
    const value = run('normalized', { timeline });
    expect(playerTimeline(value)).toBe(timeline);
    expect(playerTimeline({ ...value, playerTimelines: [timeline, [{ ...timeline[0], hp: 20 }]] }, 1)[0].hp).toBe(20);
    expect(playerTimeline(value, 1)).toEqual([]);
  });

  it('filters coop compositions with search and favorites and preserves missing telemetry', () => {
    const a = run('favorite.run');
    a.players.push({ ...a.players[0], id: 2, character: 'Silent' });
    a.playerCount = 2;
    a.isMultiplayer = true;
    a.playerTimelines = [[
      { floor: 1, hp: 10, maxHp: 80, damageTaken: 0, hpHealed: 0, recordedFields: ['hp', 'maxHp', 'damageTaken'] },
      { floor: 2, hp: 0, maxHp: 80, damageTaken: 0, hpHealed: 0, recordedFields: ['maxHp'] },
    ] as TimelinePoint[], []];
    const b = { ...a, id: 'other.run', fileName: 'other.run', status: 'abandoned' as const, win: false };
    const page = runPage([a, b], { coop: true, favorites: [a.id], search: 'favorite' });
    expect(page.compositions).toHaveLength(1);
    expect(page.compositions![0]).toMatchObject({ sample: 1, completed: 1, winRate: 1 });
    expect(page.telemetry![0]).toMatchObject({ lowHpNodes: 1, hpSamples: 1, damage: 0, damageSamples: 1, healed: null });
    expect(page.telemetry![1]).toMatchObject({ damage: null, healed: null, lowHpNodes: null });
    expect(coopSummary([b]).compositions[0].winRate).toBeNull();
  });
});
