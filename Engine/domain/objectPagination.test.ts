import { describe, expect, it } from 'vitest';
import { UnifiedObjectRegistry } from './objectAnalysis';
import { normalizeRun } from './parser';

describe('complete object evidence pagination', () => {
  it('reaches observations after the old 200-record cutoff with stable IDs', () => {
    const runs = Array.from({ length: 240 }, (_, index) => normalizeRun({
      win: index % 2 === 0, start_time: 100 + index, run_time: 600,
      players: [{ id: 1, character: 'CHARACTER.IRONCLAD', deck: [{ id: 'CARD.SYNTHETIC_EVIDENCE' }], relics: [] }],
      map_point_history: [],
    }, `synthetic-${index}.run`));
    const registry = new UnifiedObjectRegistry(runs, null);
    const query = { kind: 'card' as const, id: 'CARD.SYNTHETIC_EVIDENCE' };
    const first = registry.object({ ...query, evidenceLimit: 200 })!;
    const second = registry.object({ ...query, evidenceOffset: 200, evidenceLimit: 200 })!;
    const complete = registry.object({ ...query, evidenceLimit: 500 })!;
    expect(first.evidence).toHaveLength(200);
    expect(second.evidence.length).toBeGreaterThan(0);
    expect(first.evidenceTotal).toBe(complete.evidence.length);
    expect([...first.evidence, ...second.evidence]).toEqual(complete.evidence);
    expect(new Set(complete.evidence.map(row => row.id)).size).toBe(complete.evidence.length);
    expect(registry.object({ ...query, evidenceLimit: 0, runLimit: 0 })).toMatchObject({ evidenceLimit: 1, runLimit: 1 });
  });
});
