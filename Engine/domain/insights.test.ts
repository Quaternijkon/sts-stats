import { describe, expect, it } from 'vitest';
import { normalizeRun } from './parser';
import { buildPlayerInsightProfile } from './insights';
import type { NormalizedRunV2 } from './types';

function run(index: number, win = true): NormalizedRunV2 {
  const value = normalizeRun({
    seed: `seed-${index}`, win, ascension: 10, build_id: 'test', game_mode: 'standard',
    run_time: 1200 + index * 10, start_time: 1000 + index,
    players: [{ id: 1, character: 'CHARACTER.SILENT', deck: Array.from({ length: 18 }, (_, card) => ({ id: `CARD.${card}` })), relics: [] }],
    map_point_history: []
  }, `${index}.run`) as unknown as NormalizedRunV2;
  value.finalHp = win ? Math.max(1, 20 - index) : 0;
  value.maxHp = 70;
  return value;
}

describe('curated player insights', () => {
  it('produces finite milestones, a title and reusable badges from run data', () => {
    const profile = buildPlayerInsightProfile(Array.from({ length: 12 }, (_, index) => run(index, index !== 7)));
    expect(profile.title).toBeTruthy();
    expect(profile.badges.some((badge) => badge.id === 'main')).toBe(true);
    expect(profile.insights.some((insight) => insight.category === 'milestone')).toBe(true);
    expect(JSON.stringify(profile)).not.toMatch(/NaN|Infinity/);
  });

  it('returns a stable empty profile before data is imported', () => {
    const profile = buildPlayerInsightProfile([]);
    expect(profile.summary.completed).toBe(0);
    expect(profile.insights).toEqual([]);
  });
});
