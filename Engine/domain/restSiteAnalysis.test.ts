import { describe, expect, it } from 'vitest';
import { analyzeRestSites } from './restSiteAnalysis';
import { normalizeRun } from './parser';
import type { NormalizedRunV2, TimelinePoint } from './types';

function point(floor: number, type: string, hp = 50, restChoices: string[] = [], extra: Partial<TimelinePoint> = {}): TimelinePoint {
  return { floor, act: 1, actFloor: floor, type, label: type, hp, maxHp: 100, gold: 0,
    damageTaken: 0, hpHealed: 0, goldGained: 0, goldSpent: 0, recordedFields: ['hp', 'maxHp'], restChoices, ...extra };
}
function run(timeline: TimelinePoint[], extra = {}): NormalizedRunV2 {
  return { id: 'synthetic', timeline, map: [], raw: {}, players: [{ id: 1 }], ...extra } as unknown as NormalizedRunV2;
}
function choice(result: ReturnType<typeof analyzeRestSites>, id: string) { return result.choices.find(row => row.id === id)!; }

describe('rest site decision analysis', () => {
  it('uses previous recorded HP, not healed rest snapshots, and computes correct binary correlations', () => {
    const input = [run([
      point(1, 'monster', 10), point(2, 'rest_site', 70, ['HEAL']), point(3, 'shop', 80),
      point(4, 'rest_site', 80, ['SMITH']), point(5, 'monster', 90), point(6, 'rest_site', 90, ['SMITH'])
    ])];
    const result = analyzeRestSites(input);
    expect(result.recordedChoiceSites).toBe(3);
    expect(result.completeIntervals).toBe(2);
    expect(result.censoredIntervals).toBe(1);
    expect(choice(result, 'HEAL').meanHp).toBe(10);
    expect(choice(result, 'HEAL').meanHpPercent).toBe(.1);
    expect(choice(result, 'HEAL').hpCorrelation).toBeCloseTo(-.9933992678);
    const shop = result.routes.find(row => row.id === 'shop')!;
    expect(shop.presentSamples).toBe(1);
    expect(shop.absentSamples).toBe(1);
    expect(shop.choices.find(row => row.id === 'HEAL')).toMatchObject({ presentRate: 1, absentRate: 0, rateDifference: 1, phi: 1 });
    expect(result.hpPercentBins[0].choices.find(row => row.id === 'HEAL')?.rate).toBe(1);
    expect(result.hpPercentBins.at(-1)?.sample).toBe(2);
  });

  it('preserves multiple choices and repetitions without treating actions as mutually exclusive', () => {
    const result = analyzeRestSites([run([point(1, 'monster', 20), point(2, 'rest', 50, ['REST', 'HEAL', 'SMITH', 'CLONE', 'TRAIN']), point(3, 'rest', 50)])]);
    expect(result.siteCount).toBe(2);
    expect(result.recordedChoiceSites).toBe(1);
    expect(result.multiChoiceSites).toBe(1);
    expect(result.completeIntervals).toBe(1);
    expect(choice(result, 'HEAL')).toMatchObject({ count: 2, siteCount: 1, siteRate: 1, hpCorrelation: null, name: '休息' });
    expect(choice(result, 'SMITH').name).toBe('锻造');
    expect(choice(result, 'CLONE').name).toBe('克隆');
    expect(choice(result, 'LIFT').name).toBe('锻炼');
    expect(result.routes[0].choices[0].phi).toBeNull();
    expect(result.routes[0].choices[0].presentRate).toBeNull();
  });

  it('does not invent HP for first sites, gaps, cross-act transitions or missing telemetry', () => {
    const result = analyzeRestSites([run([
      point(1, 'rest', 70, ['HEAL']),
      point(2, 'monster', 0, [], { recordedFields: ['maxHp'] }), point(3, 'rest', 30, ['HEAL']),
      point(4, 'monster', 20), point(5, 'rest', 50, ['HEAL'], { actFloor: 6 }),
      point(6, 'rest', 90, ['SMITH'], { act: 2, actFloor: 1 })
    ])]);
    expect(result.hpSamples).toBe(0);
    expect(result.hpPercentSamples).toBe(0);
    expect(choice(result, 'HEAL').meanHp).toBeNull();
    expect(result.incompleteIntervals).toBe(1);
    expect(result.completeIntervals).toBe(2);
  });

  it('keeps zero HP valid and excludes missing, zero or inconsistent maximum HP from percentages', () => {
    const result = analyzeRestSites([run([
      point(1, 'monster', 0), point(2, 'rest', 30, ['HEAL']),
      point(3, 'monster', 40, [], { maxHp: 0 }), point(4, 'rest', 50, ['HEAL']),
      point(5, 'monster', 40, [], { maxHp: 0, recordedFields: ['hp'] }), point(6, 'rest', 50, ['SMITH']),
      point(7, 'monster', 120), point(8, 'rest', 120, ['SMITH'])
    ])]);
    expect(result.hpSamples).toBe(4);
    expect(result.hpPercentSamples).toBe(1);
    expect(choice(result, 'HEAL').meanHp).toBe(20);
    expect(choice(result, 'HEAL').meanHpPercent).toBe(0);
  });

  it('separates censored and unknown intervals and does not count either as route absence', () => {
    const result = analyzeRestSites([run([
      point(1, 'rest', 50, ['HEAL']), point(2, 'unknown'), point(3, 'rest', 50, ['SMITH']),
      point(4, 'elite'), point(5, 'rest', 50, ['CLONE']), point(6, 'shop')
    ])]);
    expect(result.completeIntervals).toBe(1);
    expect(result.incompleteIntervals).toBe(1);
    expect(result.censoredIntervals).toBe(1);
    expect(result.routes.find(row => row.id === 'shop')).toMatchObject({ presentSamples: 0, absentSamples: 1 });
    expect(result.routes.find(row => row.id === 'elite')).toMatchObject({ presentSamples: 1, absentSamples: 0 });
  });

  it('rebuilds legacy normalized zero defaults using raw presence and resolves actual question-mark rooms', () => {
    const node = (type: string, room: string, stats: object) => ({ map_point_type: type, rooms: [{ room_type: room }], player_stats: [{ player_id: 1, ...stats }] });
    const raw = { players: [{ id: 1, character: 'Silent', deck: [], relics: [] }], map_point_history: [[
      node('monster', 'monster', { current_hp: 20, max_hp: 80 }),
      node('rest_site', 'rest_site', { current_hp: 50, max_hp: 80, rest_site_choices: ['HEAL'] }),
      node('unknown', 'shop', { current_hp: 50, max_hp: 80 }),
      node('unknown', 'monster', { max_hp: 80 }),
      node('rest_site', 'rest_site', { current_hp: 70, max_hp: 80, rest_site_choices: ['SMITH'] })
    ]] };
    const parsed = normalizeRun(raw, 'synthetic.run');
    for (const node of parsed.timeline) delete node.recordedFields;
    const before = JSON.stringify(parsed);
    const result = analyzeRestSites([parsed]);
    expect(result.hpSamples).toBe(1);
    expect(choice(result, 'HEAL').meanHpPercent).toBe(.25);
    expect(choice(result, 'SMITH').meanHp).toBeNull();
    expect(result.routes.find(row => row.id === 'shop')?.presentSamples).toBe(1);
    expect(result.routes.find(row => row.id === 'monster')?.presentSamples).toBe(1);
    expect(JSON.stringify(parsed)).toBe(before);
    const rawOnly = { ...parsed, map: [] };
    expect(analyzeRestSites([rawOnly]).hpSamples).toBe(1);
  });

  it('detects skipped null history nodes via actFloor and includes complete cross-act routes', () => {
    const node = (type: string, choices: string[] = []) => ({ map_point_type: type, player_stats: [{ current_hp: 20, max_hp: 80, rest_site_choices: choices }] });
    const parsed = normalizeRun({ players: [{ id: 1, character: 'Silent' }], map_point_history: [
      [node('rest_site', ['HEAL']), null, node('monster'), node('rest_site', ['SMITH']), node('boss')],
      [node('ancient'), node('rest_site', ['CLONE'])]
    ] }, 'synthetic-gap.run');
    const result = analyzeRestSites([parsed]);
    expect(result.incompleteIntervals).toBe(1);
    expect(result.completeIntervals).toBe(1);
    expect(result.routes.find(row => row.id === 'boss')?.presentSamples).toBe(1);
    expect(result.routes.find(row => row.id === 'ancient')?.presentSamples).toBe(1);
  });

  it('preserves elite/boss map identity and treats a revealed rest room with no choice as the interval boundary', () => {
    const node = (type: string, room: string, choices: string[] = []) => ({ map_point_type: type, rooms: [{ room_type: room }], player_stats: [{ current_hp: 20, max_hp: 80, rest_site_choices: choices }] });
    const parsed = normalizeRun({ players: [{ id: 1, character: 'Silent' }], map_point_history: [[
      node('rest_site', 'rest_site', ['HEAL']), node('elite', 'monster'), node('boss', 'monster'),
      node('unknown', 'rest_site'), node('shop', 'shop'), node('rest_site', 'rest_site', ['SMITH'])
    ]] }, 'synthetic-rooms.run');
    const result = analyzeRestSites([parsed]);
    expect(result.siteCount).toBe(3);
    expect(result.recordedChoiceSites).toBe(2);
    expect(result.completeIntervals).toBe(1);
    expect(result.routes.find(row => row.id === 'elite')?.presentSamples).toBe(1);
    expect(result.routes.find(row => row.id === 'boss')?.presentSamples).toBe(1);
    expect(result.routes.find(row => row.id === 'monster')?.presentSamples).toBe(0);
    expect(result.routes.find(row => row.id === 'shop')?.presentSamples).toBe(0);
  });

  it('aligns raw room telemetry by location rather than borrowing an unrelated array index', () => {
    const parsed = normalizeRun({ players: [{ id: 1, character: 'Silent' }], map_point_history: [[
      { map_point_type: 'monster', rooms: [{ room_type: 'monster' }], player_stats: [{ current_hp: 20, max_hp: 80 }] },
      { map_point_type: 'rest_site', player_stats: [{ rest_site_choices: ['HEAL'], current_hp: 40, max_hp: 80 }] },
      { map_point_type: 'unknown', rooms: [{ room_type: 'shop' }], player_stats: [{ current_hp: 40, max_hp: 80 }] },
      { map_point_type: 'rest_site', player_stats: [{ rest_site_choices: ['SMITH'], current_hp: 40, max_hp: 80 }] }
    ]] }, 'synthetic-offset.run');
    parsed.timeline = parsed.timeline.slice(1);
    const result = analyzeRestSites([parsed]);
    expect(result.completeIntervals).toBe(1);
    expect(result.routes.find(row => row.id === 'shop')?.presentSamples).toBe(1);
    expect(choice(result, 'HEAL').meanHp).toBeNull();
  });

  it('returns stable empty tables with undefined proportions rather than fabricated zeroes', () => {
    const result = analyzeRestSites([]);
    expect(result.siteCount).toBe(0);
    expect(result.choices).toEqual([]);
    expect(result.hpBins).toHaveLength(6);
    expect(result.routes).toHaveLength(7);
    expect(result.routes.every(row => row.presentSamples === 0 && row.absentSamples === 0)).toBe(true);
  });
});
