import { describe, expect, it } from 'vitest';
import { normalizeRun } from './parser';
import { StatObjectRegistry } from './statObjects';
import type { NormalizedRunV2 } from './types';

describe('statistical object registry', () => {
  it('links an ancient, its relic options, the selected relic, acquisition floor and run result', () => {
    const run = normalizeRun({
      win: true,
      start_time: 100,
      players: [{
        id: 1,
        character: 'CHARACTER.SILENT',
        deck: [],
        relics: [{ id: 'RELIC.PAELS_EYE', floor_added_to_deck: 18 }]
      }],
      map_point_history: [Array.from({ length: 18 }, (_, index) => index === 17 ? {
        map_point_type: 'ancient',
        rooms: [{ model_id: 'EVENT.PAEL', room_type: 'event' }],
        player_stats: [{
          player_id: 1,
          ancient_choice: [
            { TextKey: 'PAELS_EYE', title: { table: 'relics', key: 'PAELS_EYE.title' }, was_chosen: true },
            { TextKey: 'PAELS_WING', title: { table: 'relics', key: 'PAELS_WING.title' }, was_chosen: false }
          ],
          relic_choices: [{ choice: 'RELIC.PAELS_EYE', was_picked: true }]
        }]
      } : { map_point_type: 'monster', rooms: [], player_stats: [{ player_id: 1 }] })]
    }, 'ancient.run');

    const registry = new StatObjectRegistry([run as unknown as NormalizedRunV2]);
    const ancient = registry.ancient('EVENT.PAEL');
    const relic = registry.relic('RELIC.PAELS_EYE');
    const floor = registry.floor(18);

    expect(ancient?.visits).toBe(1);
    expect(ancient?.optionStats()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'RELIC.PAELS_EYE', offered: 1, picked: 1, pickRate: 1, wins: 1, winRate: 1 }),
      expect.objectContaining({ id: 'RELIC.PAELS_WING', offered: 1, picked: 0 })
    ]));
    expect(relic?.events[0]).toMatchObject({ floor: 18, source: 'ancient', ancientId: 'EVENT.PAEL' });
    expect(relic?.ancientStats()[0]).toMatchObject({ id: 'EVENT.PAEL', offered: 1, picked: 1 });
    expect(floor?.events[0].point).toMatchObject({ type: 'ancient', label: 'EVENT.PAEL' });
  });
});
