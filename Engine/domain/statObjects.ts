import { StatisticalObject } from './statObjectBase.js';
export { StatisticalObject } from './statObjectBase.js';
import { UnifiedObjectRegistry } from './objectAnalysis.js';
import type { ObjectQuery } from './objectTypes.js';
import type { CareerProgress } from './types.js';
import { wilsonInterval } from './quant.js';
import type { NormalizedRunV2, TimelinePoint } from './types.js';

export type RelicAcquisitionSource = 'ancient' | 'shop' | 'boss' | 'elite' | 'treasure' | 'event' | 'reward' | 'starting' | 'unknown';

export type AncientOptionEvent = {
  ancientId: string;
  relicId: string;
  chosen: boolean;
  floor: number;
  act: number;
  playerIndex: number;
  playerCharacter: string;
  run: NormalizedRunV2;
};

export type AncientVisit = {
  ancientId: string;
  floor: number;
  act: number;
  playerIndex: number;
  playerCharacter: string;
  run: NormalizedRunV2;
  options: AncientOptionEvent[];
};

export type RelicAcquisition = {
  relicId: string;
  floor: number;
  act: number;
  source: RelicAcquisitionSource;
  ancientId: string | null;
  roomId: string | null;
  playerIndex: number;
  playerCharacter: string;
  run: NormalizedRunV2;
};

export type FloorOccurrence = {
  floor: number;
  run: NormalizedRunV2;
  point: TimelinePoint;
  playerIndex: number;
  playerCharacter: string;
};

export type ChoiceStatRow = {
  id: string;
  offered: number;
  picked: number;
  pickRate: number;
  completedPicked: number;
  wins: number;
  winRate: number;
  baselineWinRate: number;
  delta: number;
  ciLow: number;
  ciHigh: number;
  averageFloor: number;
  relatedRunIds: string[];
};

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function uniqueRuns<T extends { run: NormalizedRunV2 }>(events: T[]): NormalizedRunV2[] {
  return [...new Map(events.map((event) => [event.run.id, event.run])).values()];
}

function ancientRelicId(choice: Record<string, unknown>): string {
  const direct = String(choice.relicId || choice.id || '');
  if (direct) return direct.startsWith('RELIC.') ? direct : `RELIC.${direct.replace(/\.title$/i, '')}`;
  const title = choice.title as { key?: unknown } | undefined;
  const key = String(title?.key || choice.TextKey || choice.textKey || '').replace(/\.title$/i, '');
  return key ? `RELIC.${key}` : '';
}

function arrayField<T = Record<string, unknown>>(point: TimelinePoint, key: string): T[] {
  const value = point[key];
  return Array.isArray(value) ? value as T[] : [];
}

function pointForFloor(timeline: TimelinePoint[], floor: number): TimelinePoint | undefined {
  return timeline.find((point) => Number(point.floor) === floor);
}

function acquisitionSource(point: TimelinePoint | undefined, relicId: string, ancientId: string | null): RelicAcquisitionSource {
  if (ancientId) return 'ancient';
  if (!point) return 'starting';
  if (arrayField<string>(point, 'boughtRelics').includes(relicId)) return 'shop';
  const picked = arrayField<{ id?: unknown; picked?: unknown }>(point, 'relicChoices').some((choice) => String(choice.id || '') === relicId && Boolean(choice.picked));
  if (!picked) return 'starting';
  const type = String(point.type || '').toLowerCase();
  if (type === 'boss') return 'boss';
  if (type === 'elite') return 'elite';
  if (type === 'treasure') return 'treasure';
  if (type === 'event' || type === 'ancient') return 'event';
  return 'reward';
}

export function relicAcquisitionSourceLabel(source: RelicAcquisitionSource): string {
  return ({ ancient: '先古之民', shop: '商店购买', boss: '首领奖励', elite: '精英奖励', treasure: '宝箱', event: '事件', reward: '节点奖励', starting: '初始持有', unknown: '来源未标记' })[source];
}

export class AncientStatObject extends StatisticalObject<AncientVisit> {
  get visits(): number { return this.events.length; }
  get nodeVisits(): number { return new Set(this.events.map((event) => `${event.run.id}:${event.floor}`)).size; }
  get averageFloor(): number { return average(this.events.map((event) => event.floor)); }
  get optionKinds(): number { return new Set(this.events.flatMap((event) => event.options.map((option) => option.relicId))).size; }

  optionStats(): ChoiceStatRow[] {
    const baselineRuns = this.events.map((event) => event.run).filter((run) => run.status !== 'abandoned');
    const baselineWinRate = baselineRuns.length ? baselineRuns.filter((run) => run.win).length / baselineRuns.length : 0;
    const groups = new Map<string, AncientOptionEvent[]>();
    for (const option of this.events.flatMap((event) => event.options)) {
      const rows = groups.get(option.relicId) || [];
      rows.push(option);
      groups.set(option.relicId, rows);
    }
    return [...groups.entries()].map(([id, rows]) => {
      const picked = rows.filter((row) => row.chosen);
      const completedPicked = picked.filter((row) => row.run.status !== 'abandoned');
      const wins = completedPicked.filter((row) => row.run.win).length;
      const interval = wilsonInterval(wins, completedPicked.length);
      const winRate = completedPicked.length ? wins / completedPicked.length : 0;
      return {
        id,
        offered: rows.length,
        picked: picked.length,
        pickRate: rows.length ? picked.length / rows.length : 0,
        completedPicked: completedPicked.length,
        wins,
        winRate,
        baselineWinRate,
        delta: winRate - baselineWinRate,
        ciLow: interval.low,
        ciHigh: interval.high,
        averageFloor: average(rows.map((row) => row.floor)),
        relatedRunIds: [...new Set(picked.map((row) => row.run.id))]
      };
    }).sort((left, right) => right.offered - left.offered || right.picked - left.picked);
  }
}

export class RelicStatObject extends StatisticalObject<RelicAcquisition> {
  get averageAcquisitionFloor(): number { return average(this.events.map((event) => event.floor).filter((floor) => floor > 0)); }

  constructor(id: string, events: RelicAcquisition[], readonly ancientOptions: AncientOptionEvent[]) {
    super(id, events);
  }

  ancientStats(): ChoiceStatRow[] {
    const groups = new Map<string, AncientOptionEvent[]>();
    for (const option of this.ancientOptions) {
      const rows = groups.get(option.ancientId) || [];
      rows.push(option);
      groups.set(option.ancientId, rows);
    }
    return [...groups.entries()].map(([id, rows]) => {
      const baselineRuns = rows.map((row) => row.run).filter((run) => run.status !== 'abandoned');
      const baselineWinRate = baselineRuns.length ? baselineRuns.filter((run) => run.win).length / baselineRuns.length : 0;
      const picked = rows.filter((row) => row.chosen);
      const completedPicked = picked.filter((row) => row.run.status !== 'abandoned');
      const wins = completedPicked.filter((row) => row.run.win).length;
      const winRate = completedPicked.length ? wins / completedPicked.length : 0;
      const interval = wilsonInterval(wins, completedPicked.length);
      return {
        id,
        offered: rows.length,
        picked: picked.length,
        pickRate: rows.length ? picked.length / rows.length : 0,
        completedPicked: completedPicked.length,
        wins,
        winRate,
        baselineWinRate,
        delta: winRate - baselineWinRate,
        ciLow: interval.low,
        ciHigh: interval.high,
        averageFloor: average(rows.map((row) => row.floor)),
        relatedRunIds: [...new Set(picked.map((row) => row.run.id))]
      };
    }).sort((left, right) => right.offered - left.offered);
  }
}

export class FloorStatObject extends StatisticalObject<FloorOccurrence> {
  get visits(): number { return this.events.length; }
  get averageHp(): number { return average(this.events.map((event) => Number(event.point.hp || 0))); }
  get averageGold(): number { return average(this.events.map((event) => Number(event.point.gold || 0))); }
  get averageDamage(): number { return average(this.events.map((event) => Number(event.point.damageTaken || 0))); }
  get ancientVisits(): number { return this.events.filter((event) => String(event.point.type || '').toLowerCase() === 'ancient').length; }
}

export class StatObjectRegistry {
  readonly ancientVisits: AncientVisit[] = [];
  readonly ancientOptions: AncientOptionEvent[] = [];
  readonly relicAcquisitions: RelicAcquisition[] = [];
  readonly floorOccurrences: FloorOccurrence[] = [];
  private readonly ancientMap = new Map<string, AncientStatObject>();
  private readonly relicMap = new Map<string, RelicStatObject>();
  private readonly floorMap = new Map<string, FloorStatObject>();

  readonly unified: UnifiedObjectRegistry;

  constructor(readonly runs: NormalizedRunV2[], progress: CareerProgress | null = null) {
    this.unified = new UnifiedObjectRegistry(runs, progress);
    this.extract();
  }

  objects(query: ObjectQuery) { return this.unified.objects(query); }
  object(query: ObjectQuery) { return this.unified.object(query); }

  private extract() {
    for (const run of this.runs) {
      const timelines = run.playerTimelines?.length ? run.playerTimelines : [run.timeline || []];
      for (let playerIndex = 0; playerIndex < timelines.length; playerIndex += 1) {
        const timeline = timelines[playerIndex] || [];
        const player = run.players[playerIndex] || run.players[0];
        const playerCharacter = player?.character || run.character;
        for (const point of timeline) this.floorOccurrences.push({ floor: Number(point.floor || 0), run, point, playerIndex, playerCharacter });
        for (const point of timeline) {
          if (String(point.type || '').toLowerCase() !== 'ancient') continue;
          const ancientId = String(point.label || 'EVENT.UNKNOWN_ANCIENT');
          const options = arrayField<Record<string, unknown>>(point, 'ancientChoices').map((choice) => ({
            ancientId,
            relicId: ancientRelicId(choice),
            chosen: Boolean(choice.chosen),
            floor: Number(point.floor || 0),
            act: Number(point.act || 0),
            playerIndex,
            playerCharacter,
            run
          })).filter((option) => option.relicId);
          const visit = { ancientId, floor: Number(point.floor || 0), act: Number(point.act || 0), playerIndex, playerCharacter, run, options };
          this.ancientVisits.push(visit);
          this.ancientOptions.push(...options);
        }

        for (const relic of player?.relics || []) {
          const floor = Number(relic.floorAdded || 0);
          const point = pointForFloor(timeline, floor);
          const ancient = this.ancientOptions.find((option) => option.run.id === run.id && option.playerIndex === playerIndex && option.floor === floor && option.relicId === relic.id && option.chosen);
          this.relicAcquisitions.push({
            relicId: relic.id,
            floor,
            act: Number(point?.act || 0),
            source: acquisitionSource(point, relic.id, ancient?.ancientId || null),
            ancientId: ancient?.ancientId || null,
            roomId: point ? String(point.label || '') || null : null,
            playerIndex,
            playerCharacter,
            run
          });
        }
      }
    }

    for (const [id, visits] of this.groupBy(this.ancientVisits, (visit) => visit.ancientId)) this.ancientMap.set(id, new AncientStatObject(id, visits));
    for (const [id, events] of this.groupBy(this.relicAcquisitions, (event) => event.relicId)) {
      this.relicMap.set(id, new RelicStatObject(id, events, this.ancientOptions.filter((option) => option.relicId === id)));
    }
    for (const [id, events] of this.groupBy(this.floorOccurrences, (event) => String(event.floor))) this.floorMap.set(id, new FloorStatObject(id, events));
  }

  private groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const value of values) {
      const id = key(value);
      const rows = groups.get(id) || [];
      rows.push(value);
      groups.set(id, rows);
    }
    return groups;
  }

  get ancients(): AncientStatObject[] { return [...this.ancientMap.values()].sort((left, right) => right.visits - left.visits); }
  get relics(): RelicStatObject[] { return [...this.relicMap.values()].sort((left, right) => right.events.length - left.events.length); }
  ancient(id: string): AncientStatObject | null { return this.ancientMap.get(id) || null; }
  relic(id: string): RelicStatObject | null { return this.relicMap.get(id) || new RelicStatObject(id, [], this.ancientOptions.filter((option) => option.relicId === id)); }
  floor(id: string | number): FloorStatObject | null { return this.floorMap.get(String(id)) || null; }
}
