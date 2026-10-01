import { describe, expect, it } from 'vitest';
import { cardChoicePerspectiveRuns } from './objectPerspectives';
import type { NormalizedRunV2 } from './types';

describe('card choice perspectives', () => {
  it('keeps every candidate pick flag as an atomic observation', () => {
    const run = {
      id: 'atomic.run', sourceKey: 'atomic.run', character: 'Silent',
      players: [{ character: 'Silent', deck: [], relics: [] }],
      playerTimelines: [[{
        floor: 2,
        cardChoices: [{ id: 'CARD.A', picked: true }, { id: 'CARD.B', picked: true }, { id: 'CARD.A', picked: false }]
      }]],
      timeline: [], cardChoices: [], deck: [], relics: [], relicEvents: []
    } as unknown as NormalizedRunV2;
    const [perspective] = cardChoicePerspectiveRuns([run], 'Silent');
    expect(perspective.cardChoices).toEqual([
      { floor: 2, offered: ['CARD.A'], picked: 'CARD.A' },
      { floor: 2, offered: ['CARD.B'], picked: 'CARD.B' },
      { floor: 2, offered: ['CARD.A'], picked: null }
    ]);
  });
});
