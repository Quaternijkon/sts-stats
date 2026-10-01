import type { NormalizedRunV2 } from './types.js';

export abstract class StatisticalObject<TEvent extends { run: NormalizedRunV2 }> {
  constructor(readonly id: string, readonly events: TEvent[]) {}

  get relatedRuns(): NormalizedRunV2[] {
    return [...new Map(this.events.map((event) => [event.run.id, event.run])).values()];
  }

  get completedRuns(): NormalizedRunV2[] {
    return this.relatedRuns.filter((run) => run.status !== 'abandoned');
  }

  get winRate(): number | null {
    return this.completedRuns.length ? this.completedRuns.filter((run) => run.win).length / this.completedRuns.length : null;
  }
}
