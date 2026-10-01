import { cardPoolIDs, classifyObjectCardPools } from './cardPools.js';
import type { CardPool } from './cardPools.js';
import { wilsonInterval } from './quant.js';
import { cardHoldingBreakdowns } from './cardHoldingBreakdowns.js';
import { StatisticalObject } from './statObjectBase.js';
import { extractObjectObservations } from './objectObservations.js';
import { extractObjectCareer } from './objectCareer.js';
import { zhFromTable } from './i18n.js';
import { dataItemLabel } from './dataItems.js';
import { matchesFilter } from './query.js';
import { EMPTY_FILTER } from './schemas.js';
import { OBJECT_KINDS, objectKey } from './objectTypes.js';
import type { CareerProgress, DataItemRef, NormalizedRunV2 } from './types.js';
import type { ObjectKind, ObjectRef, ObjectIdentity, ObjectObservation, ObjectCareerRecord, ObjectMetric, ObjectSummary, ObjectRow, ObjectQuery, ObjectScope, ObjectListResponse, ObjectDetailResponse, ObjectBreakdown, ObjectSource, ObjectTableRow } from './objectTypes.js';
import { gameCharacters } from './game.js';

// Calculate on the complete filtered population, before sorting/pagination.
// PERCENT_RANK uses the first rank for ties: count(strictly smaller) / (n - 1).
export function addObjectNumericFills(rows: ObjectRow[]): void {
  const columns = new Map<string, { row: ObjectRow; value: number; percent: boolean }[]>();
  for (const row of rows) {
    row.fills = {};
    row.heat = {};
    const add = (key: string, value: number | null, format: string) => {
      if (value === null || !Number.isFinite(value) || !['number', 'duration', 'percent'].includes(format)) return;
      if (format === 'percent') row.fills![key] = Math.max(0, Math.min(1, value));
      const column = columns.get(key) || [];
      column.push({ row, value, percent: format === 'percent' });
      columns.set(key, column);
    };
    for (const [id, value] of Object.entries(row.summary)) add(`summary.${id}`, value, id === 'winRate' ? 'percent' : 'number');
    for (const metric of row.metrics || []) add(`metrics.${metric.id}`, metric.value, metric.format);
    // The list displays summary zeroes when a recorded object has no explicit
    // metric for these columns. Include those visible zeroes in the same ranking.
    if (row.summary.runs > 0) {
      for (const id of ['offered', 'picked', 'acquired', 'held'] as const) {
        if (!row.metrics?.some((metric) => metric.id === id)) add(`metrics.${id}`, row.summary[id], 'number');
      }
    }
    for (const metric of row.careerMetrics || []) add(`career.${metric.id}`, metric.value, metric.format);
  }
  for (const [key, column] of columns) {
    column.sort((a, b) => a.value - b.value);
    // Colour conveys magnitude, independently of the percentile bar length.
    const minimum = Math.min(0, column[0].value);
    const span = column[column.length - 1].value - minimum;
    let firstRank = 0;
    column.forEach((entry, index) => {
      if (index > 0 && entry.value !== column[index - 1].value) firstRank = index;
      if (!entry.percent) entry.row.fills![key] = column.length > 1 ? firstRank / (column.length - 1) : 0;
      entry.row.heat![key] = span > 0 ? (entry.value - minimum) / span : 0;
    });
  }
}

const SOURCE_LABELS: Record<string, string> = { run: '对局记录', raw: '原始记录', timeline: '节点记录', normalized: '标准记录', cardChoices: '选项记录', relicChoices: '选项记录', potionChoices: '选项记录', ancientChoices: '选项记录', eventChoices: '选项记录', encounterEvents: '战斗记录', floor: '楼层记录', act: '阶段记录', type: '节点类型', deck: '最终持有记录', relics: '最终持有记录', restChoices: '休息记录', startingDeck: '初始持有记录', startingRelics: '初始持有记录' };
function sourceLabel(source: string): string { return source.split('.').map((part) => SOURCE_LABELS[part] || part).join(' · '); }
const EVENT_IDS = ['offered', 'picked', 'skipped', 'acquired', 'bought', 'removed', 'upgraded', 'downgraded', 'transformedFrom', 'transformedTo', 'enchanted', 'used', 'discarded', 'held', 'visited', 'selected', 'completed', 'applied', 'recorded', 'reached', 'fought'];
const METRIC_LABELS: Record<string, string> = {
  observations: '记录次数', runs: '关联局数', completedRuns: '完成局数', wins: '胜利局数', winRate: '关联对局胜率', averageFloor: '平均记录楼层',
  offered: '可选次数', picked: '选取次数', skipped: '跳过次数', acquired: '获得次数', bought: '购买次数', removed: '移除次数',
  upgraded: '升级次数', downgraded: '降级次数', transformedFrom: '变化前次数', transformedTo: '变化后次数', enchanted: '附魔次数',
  used: '使用次数', discarded: '丢弃次数', held: '最终持有次数', visited: '访问次数', selected: '选择次数', completed: '完成次数',
  applied: '应用次数', recorded: '记录次数', reached: '到达次数', fought: '战斗次数', pickRate: '选取率',
  averageAcquisitionFloor: '平均获得楼层', averageDamage: '平均承受伤害', averageTurns: '平均回合数', deaths: '死亡次数', survivalRate: '存活率',
  averageHp: '平均生命', averageGold: '平均金币', averageHpHealed: '节点平均恢复生命', averageGoldGained: '节点平均获得金币', averageGoldSpent: '节点平均花费金币',
  pickedRuns: '选取局数', pickedCompletedRuns: '选取后完成局数', pickedWinRate: '选取后胜率', pickedWinCiLow: '选取后胜率下限', pickedWinCiHigh: '选取后胜率上限',
  heldRuns: '最终持有局数', heldCompletedRuns: '最终持有完成局数', heldWinRate: '最终持有胜率',
  averageDuration: '平均游戏时长', averageFinalFloor: '平均结束楼层', careerWinRate: '生涯胜率'
};
const METRIC_HELP: Record<string, string> = {
  observations: '同一局中的重复行为分别计数。', runs: '按对局标识去重后的局数。', completedRuns: '关联对局中排除放弃的局数。',
  wins: '关联对局中获胜的独立局数。', winRate: '所有关联行为（包括跳过）对应的独立对局胜率；放弃不进入分母，不等同于选取后胜率。', averageFloor: '仅计算楼层有记录的行为。',
  pickRate: '选取次数除以可选次数；仅记录已选项的日志不推算选取率。', averageDamage: '仅计算实际记录的伤害，缺失记录不作为零。',
  averageTurns: '仅计算实际记录的回合数。', deaths: '实际战斗记录中确认导致玩家死亡的次数。', survivalRate: '存活战斗次数除以结果已知的战斗次数。',
  pickedRuns: '存在实际选取记录的独立单人对局数；同局多次选取仅计一局。',
  pickedCompletedRuns: '实际选取的独立单人对局中排除放弃后的局数。',
  pickedWinRate: '实际选取的独立单人对局中，胜利局数除以完成局数；放弃不进入分母。',
  pickedWinCiLow: '选取后胜率的 95% Wilson 区间下限；样本为独立完成对局。',
  pickedWinCiHigh: '选取后胜率的 95% Wilson 区间上限；样本为独立完成对局。',
  heldRuns: '最终快照持有该对象的独立单人对局数；同局多个副本仅计一局。',
  heldCompletedRuns: '最终持有该对象的独立单人对局中排除放弃后的局数。',
  heldWinRate: '最终持有该对象的独立单人对局中，胜利局数除以完成局数；放弃不进入分母。',
  held: '最终快照中的持有记录，不代表获得次数。', averageDuration: '按独立对局计算游戏时长。', averageFinalFloor: '按独立对局计算结束楼层。'
};
function metric(id: string, value: number | null, format: ObjectMetric['format'] = 'number'): ObjectMetric {
  return { id, label: METRIC_LABELS[id] || id, value, format, help: METRIC_HELP[id] || (EVENT_IDS.includes(id) ? '按实际行为逐次计数，同一局可能出现多次。' : '仅使用实际存在的记录；没有样本时留空。') };
}
function mean(values: Array<number | undefined | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}
function identity(ref: ObjectRef): ObjectIdentity { return { kind: ref.kind, id: ref.id, label: dataItemLabel(ref as DataItemRef) }; }
function count(events: ObjectObservation[], event: string): number { return events.filter((row) => row.event === event).length; }
function summarize(events: ObjectObservation[]): ObjectSummary {
  const runs = [...new Map(events.map((row) => [row.run.id, row.run])).values()];
  const completed = runs.filter((run) => run.status !== 'abandoned');
  const wins = completed.filter((run) => run.win).length;
  return { observations: events.length, runs: runs.length, completedRuns: completed.length, wins, winRate: completed.length ? wins / completed.length : null, averageFloor: mean(events.map((row) => row.floor)), offered: count(events, 'offered'), picked: count(events, 'picked'), acquired: count(events, 'acquired'), held: count(events, 'held') };
}
function basicMetrics(events: ObjectObservation[]): ObjectMetric[] {
  const summary = summarize(events);
  return ['observations', 'runs', 'completedRuns', 'wins', 'winRate', 'averageFloor'].map((id) => metric(id, summary[id as keyof ObjectSummary], id === 'winRate' ? 'percent' : 'number'));
}

export interface ObjectCapability { metrics(events: ObjectObservation[]): ObjectMetric[] }
export class ChoiceCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] {
    const offered = count(events, 'offered');
    const picked = events.filter((event) => event.event === 'picked');
    if (!offered && !picked.length) return [];
    const summary = summarize(picked);
    const interval = summary.completedRuns ? wilsonInterval(summary.wins, summary.completedRuns) : null;
    const counts = offered ? [metric('offered', offered), metric('picked', picked.length), metric('skipped', count(events, 'skipped')), metric('pickRate', picked.length / offered, 'percent')] : [];
    return [...counts, metric('pickedRuns', summary.runs), metric('pickedCompletedRuns', summary.completedRuns), metric('pickedWinRate', summary.winRate, 'percent'), metric('pickedWinCiLow', interval?.low ?? null, 'percent'), metric('pickedWinCiHigh', interval?.high ?? null, 'percent')];
  }
}
export class HoldingCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] {
    const summary = summarize(events.filter((event) => event.event === 'held'));
    return [metric('heldRuns', summary.runs), metric('heldCompletedRuns', summary.completedRuns), metric('heldWinRate', summary.winRate, 'percent')];
  }
}
export class AcquisitionCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] { return [metric('averageAcquisitionFloor', mean(events.filter((row) => row.event === 'acquired').map((row) => row.floor)))]; }
}
export class BattleCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] {
    const battle = events.filter((row) => row.event === 'fought');
    const knownSurvival = battle.filter((row) => typeof row.telemetry?.killedPlayer === 'boolean');
    const deaths = knownSurvival.filter((row) => row.telemetry?.killedPlayer).length;
    return [metric('averageDamage', mean(battle.map((row) => row.telemetry?.damageTaken))), metric('averageTurns', mean(battle.map((row) => row.telemetry?.turns))), metric('deaths', knownSurvival.length ? deaths : null), metric('survivalRate', knownSurvival.length ? 1 - deaths / knownSurvival.length : null, 'percent')];
  }
}
export class NodeTelemetryCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] {
    const nodes = new Map<string, NonNullable<ObjectObservation['telemetry']>>();
    for (const event of events) {
      if (event.floor === null || !event.telemetry) continue;
      const key = `${event.run.id}:${event.playerIndex}:${event.floor}`;
      const telemetry = nodes.get(key) || {};
      for (const field of ['damageTaken', 'turns', 'hp', 'gold'] as const) {
        const value = event.telemetry[field];
        if (typeof value === 'number' && Number.isFinite(value)) telemetry[field] = value;
      }
      nodes.set(key, telemetry);
    }
    const values = [...nodes.values()];
    return [metric('averageDamage', mean(values.map((row) => row.damageTaken))), metric('averageTurns', mean(values.map((row) => row.turns))), metric('averageHp', mean(values.map((row) => row.hp))), metric('averageGold', mean(values.map((row) => row.gold)))];
  }
}
export class ResourceCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] {
    const nodes = new Map<string, NonNullable<ObjectObservation['telemetry']>>();
    for (const event of events) {
      if (event.floor === null || !event.telemetry) continue;
      const key = `${event.run.id}:${event.playerIndex}:${event.floor}`;
      const telemetry = nodes.get(key) || {};
      for (const field of ['hpHealed', 'goldGained', 'goldSpent'] as const) {
        const value = event.telemetry[field];
        if (typeof value === 'number' && Number.isFinite(value)) telemetry[field] = value;
      }
      nodes.set(key, telemetry);
    }
    const values = [...nodes.values()];
    return [metric('averageHpHealed', mean(values.map((row) => row.hpHealed))), metric('averageGoldGained', mean(values.map((row) => row.goldGained))), metric('averageGoldSpent', mean(values.map((row) => row.goldSpent)))].map((value) => ({ ...value, help: '对象所在节点的记录值，不表示由该对象单独造成。' }));
  }
}
export class RunCapability implements ObjectCapability {
  metrics(events: ObjectObservation[]): ObjectMetric[] {
    const runs = [...new Map(events.map((row) => [row.run.id, row.run])).values()];
    const numeric = (value: unknown): boolean => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
    const duration = (run: NormalizedRunV2): number | null => {
      const raw = run.raw || {};
      const recorded = Array.isArray(run.recordedFields) && run.recordedFields.includes('runTime');
      const explicit = ['run_time', 'play_time', 'playtime', 'duration'].some((key) => numeric(raw[key]));
      const legacy = Object.keys(raw).length === 0 && run.runTime > 0;
      return recorded || explicit || legacy ? run.runTime : null;
    };
    const finalFloor = (run: NormalizedRunV2): number | null => {
      const recorded = Array.isArray(run.recordedFields) && run.recordedFields.includes('floor');
      const explicit = ['floor', 'floor_reached', 'floors_climbed', 'current_floor'].some((key) => numeric(run.raw?.[key]));
      const nodes = (run.recordedNodeCount || 0) > 0 || run.map?.length > 0 || run.timeline?.some((point) => numeric(point.floor));
      return recorded || explicit || run.floor > 0 || nodes ? run.floor : null;
    };
    return [metric('averageDuration', mean(runs.map(duration)), 'duration'), metric('averageFinalFloor', mean(runs.map(finalFloor)))];
  }
}
export class ProgressCapability {
  metrics(records: ObjectCareerRecord[]): ObjectMetric[] {
    const groups = new Map<string, ObjectMetric[]>();
    for (const record of records) for (const value of record.metrics) {
      const group = groups.get(value.id) || []; group.push(value); groups.set(value.id, group);
    }
    const maximum = new Set(['bestWinStreak', 'maxAscension']);
    const notAdditive = new Set(['currentStreak', 'preferredAscension']);
    const result: ObjectMetric[] = [];
    for (const [id, values] of groups) {
      if (id === 'careerWinRate') continue;
      const numbers = values.map((value) => value.value).filter((value): value is number => value !== null && Number.isFinite(value));
      let value: number | null = null;
      if (numbers.length) {
        if (maximum.has(id)) value = Math.max(...numbers);
        else if (id === 'fastestWinTime') value = Math.min(...numbers);
        else if (notAdditive.has(id)) value = numbers.length === 1 ? numbers[0] : null;
        else value = numbers.reduce((sum, item) => sum + item, 0);
      }
      result.push({ ...values[0], value });
    }
    const wins = result.find((row) => row.id === 'careerWins')?.value;
    const losses = result.find((row) => row.id === 'careerLosses')?.value;
    if (wins != null && losses != null) {
      const counterRecords = records.filter((record) => record.metrics.some((value) => value.id === 'careerWins' || value.id === 'careerLosses'));
      const complete = counterRecords.every((record) => ['careerWins', 'careerLosses'].every((id) => record.metrics.some((value) => value.id === id && value.value !== null)));
      const rate = metric('careerWinRate', complete && wins + losses ? wins / (wins + losses) : null, 'percent');
      const battle = [...(groups.get('careerWins') || []), ...(groups.get('careerLosses') || [])].some((value) => value.label.startsWith('战斗'));
      result.push({ ...rate, label: groups.get('careerWinRate')?.[0]?.label || (battle ? '战斗胜率' : rate.label) });
    }
    return result;
  }
}

export class UnifiedStatisticalObject extends StatisticalObject<ObjectObservation> {
  readonly progress = new ProgressCapability();
  constructor(readonly ref: ObjectRef, events: ObjectObservation[], readonly careerRecords: ObjectCareerRecord[]) { super(ref.id, events); }
  get capabilities(): ObjectCapability[] { return []; }
  choiceEvents: ObjectObservation[] = [];
  originSources: ObjectSource[] = [];
  get summary(): ObjectSummary { return summarize(this.events); }
  get row(): ObjectRow {
    const sources = new Set<ObjectSource>(this.originSources);
    if (this.events.length) sources.add('run');
    for (const record of this.careerRecords) sources.add(record.source);
    const discovered = this.careerRecords.map((record) => record.discovered).filter((value) => value !== null);
    const states = [...new Set(this.careerRecords.map((record) => record.state).filter((state): state is string => state !== null))];
    return { ...identity(this.ref), key: objectKey(this.ref), summary: this.summary, sources: [...sources], discovered: discovered.length ? discovered.some(Boolean) : null, metrics: this.metrics(), careerMetrics: this.progress.metrics(this.careerRecords), careerState: states.length === 1 ? states[0] : null };
  }
  metrics(events = this.events): ObjectMetric[] {
    const counts = EVENT_IDS.filter((id) => events.some((row) => row.event === id)).map((id) => metric(id, count(events, id)));
    const values = [...basicMetrics(events), ...counts, ...this.capabilities.flatMap((capability) => capability.metrics(events))];
    return [...new Map(values.map((value) => [value.id, value])).values()];
  }
  choices(): ObjectBreakdown {
    const events = this.choiceEvents.length ? this.choiceEvents : this.events.filter((event) => event.choiceId);
    const groups = new Map<string, ObjectObservation[]>();
    for (const event of events) {
      const key = this.choiceEvents.length ? objectKey(event.object) : event.choiceId!;
      const rows = groups.get(key) || []; rows.push(event); groups.set(key, rows);
    }
    const columns = new Map<string, ObjectMetric>();
    const rows: ObjectTableRow[] = [...groups].map(([id, events]) => {
      const first = events[0];
      const ref = this.choiceEvents.length ? identity(first.object) : first.related.find((ref) => ref.id === first.choiceId);
      const chosen = events.filter((event) => event.event === 'picked' || event.event === 'selected');
      const values = [...basicMetrics(chosen), ...(this.choiceEvents.length ? ['offered', 'picked', 'skipped'] : ['selected']).map((event) => metric(event, count(events, event))), ...new ChoiceCapability().metrics(events)];
      for (const value of values) columns.set(value.id, value);
      const label = ref ? identity(ref).label : zhFromTable('events', first.choiceId || id, first.choiceLabel || first.choiceId || id);
      return { id, label, values: Object.fromEntries(values.map((value) => [value.id, value.value])), ...(ref ? { object: identity(ref) } : {}) };
    });
    return { id: 'choice', label: '选项', columns: [...columns.values()].map(({ id, label, format, help }) => ({ id, label, format, help })), rows };
  }
  breakdown(id: string, label: string, keys: (event: ObjectObservation) => string[]): ObjectBreakdown {
    const groups = new Map<string, ObjectObservation[]>();
    for (const event of this.events) for (const key of new Set(keys(event))) {
      const values = groups.get(key) || []; values.push(event); groups.set(key, values);
    }
    const columns = new Map<string, ObjectMetric>();
    const rows = [...groups].map(([key, events]) => {
      const metrics = this.metrics(events);
      for (const value of metrics) columns.set(value.id, value);
      const ref = id === 'character' ? identity({ kind: 'character', id: key }) : id === 'floor' ? identity({ kind: 'floor', id: key }) : undefined;
      const rowLabel = ref?.label || (id === 'event' ? METRIC_LABELS[key] || key : id === 'source' ? sourceLabel(key) : key);
      return { id: key, label: rowLabel, values: Object.fromEntries(metrics.map((value) => [value.id, value.value])), ...(ref ? { object: ref } : {}) };
    });
    return { id, label, columns: [...columns.values()].map(({ id, label, format, help }) => ({ id, label, format, help })), rows };
  }
}
export class CardObject extends UnifiedStatisticalObject {
  get capabilities(): ObjectCapability[] { return [new ChoiceCapability(), new AcquisitionCapability(), new HoldingCapability()]; }
}
export class RelicObject extends CardObject {}
export class EncounterObject extends UnifiedStatisticalObject {
  get capabilities(): ObjectCapability[] { return [new BattleCapability()]; }
}
export class AncientObject extends UnifiedStatisticalObject {
  get capabilities(): ObjectCapability[] { return [new ResourceCapability()]; }
}
export class PotionObject extends CardObject {}
export class EventObject extends UnifiedStatisticalObject {
  get capabilities(): ObjectCapability[] { return [new ResourceCapability()]; }
}
export class EnemyObject extends EncounterObject {}
export class EnchantmentObject extends UnifiedStatisticalObject {}
export class QuestObject extends UnifiedStatisticalObject {}
export class RestChoiceObject extends EventObject {}
export class BadgeObject extends UnifiedStatisticalObject {}
export class EpochObject extends UnifiedStatisticalObject {}
export class AchievementObject extends UnifiedStatisticalObject {}
export class LocationObject extends EventObject {}
export class ModifierObject extends UnifiedStatisticalObject {}
export class FacetObject extends UnifiedStatisticalObject {
  get capabilities(): ObjectCapability[] { return [new RunCapability()]; }
}
export class CharacterObject extends FacetObject {}
export class NodeObject extends FacetObject {
  get capabilities(): ObjectCapability[] { return [new RunCapability(), new NodeTelemetryCapability(), new ResourceCapability()]; }
}

const constructors: Record<ObjectKind, typeof UnifiedStatisticalObject> = {
  card: CardObject, relic: RelicObject, encounter: EncounterObject, ancient: AncientObject, potion: PotionObject, event: EventObject, enemy: EnemyObject, enchantment: EnchantmentObject, quest: QuestObject, restChoice: RestChoiceObject, badge: BadgeObject, epoch: EpochObject, achievement: AchievementObject, location: LocationObject, modifier: ModifierObject, character: CharacterObject,
  build: FacetObject, ascension: FacetObject, outcome: FacetObject, party: FacetObject, gameMode: FacetObject, floor: NodeObject, act: NodeObject, date: FacetObject, week: FacetObject, playerPosition: FacetObject, roomType: NodeObject
};
function page(value: number | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number { return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value!))) : fallback; }
function careerCharacters(query: ObjectQuery): string[] {
  const characters = query.filter?.characters || [];
  if (!query.perspective || ['all', 'overall'].includes(query.perspective)) return characters;
  return characters.length && !characters.includes(query.perspective) ? [] : [query.perspective];
}
function scope(query: ObjectQuery): ObjectScope { return { runs: 'solo', career: 'lifetime', careerCharacterFilter: careerCharacters(query), careerIgnoresRunFilters: true }; }

export class UnifiedObjectRegistry {
  private readonly soloRuns: NormalizedRunV2[];
  readonly cardPools: ReadonlyMap<string, CardPool>;
  private readonly catalogue = new Map<string, ObjectRef>();
  private readonly origins = new Map<string, Set<ObjectSource>>();
  private readonly relatedIndex = new Map<string, ObjectObservation[]>();
  readonly observations: ObjectObservation[];
  private readonly observationIndex = new Map<string, ObjectObservation[]>();
  private readonly career = new Map<string, ObjectCareerRecord[]>();
  constructor(readonly runs: NormalizedRunV2[], readonly progress: CareerProgress | null = null, cachedCardPools?: ReadonlyMap<string, CardPool>) {
    const solo = runs.filter((run) => !run.isMultiplayer && run.playerCount <= 1 && run.players.length <= 1);
    this.soloRuns = [...new Map(solo.map((run) => [run.id, run])).values()];
    this.observations = extractObjectObservations(solo);
    this.cardPools = cachedCardPools ?? classifyObjectCardPools(this.soloRuns, this.observations);
    for (const event of this.observations) {
      const key = objectKey(event.object);
      this.catalogue.set(key, event.object);
      this.origins.set(key, new Set([...(this.origins.get(key) || []), 'run']));
      for (const ref of event.related) {
        const relatedKey = objectKey(ref);
        if (!this.catalogue.has(relatedKey)) this.catalogue.set(relatedKey, ref);
        this.origins.set(relatedKey, new Set([...(this.origins.get(relatedKey) || []), 'run']));
        const relatedEvents = this.relatedIndex.get(relatedKey) || []; relatedEvents.push(event); this.relatedIndex.set(relatedKey, relatedEvents);
      }
      const group = this.observationIndex.get(key) || []; group.push(event); this.observationIndex.set(key, group);
    }
    for (const record of extractObjectCareer(progress)) {
      const key = objectKey(record.object);
      this.catalogue.set(key, record.object);
      this.origins.set(key, new Set([...(this.origins.get(key) || []), record.source]));
      const group = this.career.get(key) || []; group.push(record); this.career.set(key, group);
    }
  }
  private scopedRunIds(query: Partial<ObjectQuery>): Set<string> {
    // Null optional values use the same defaults as omitted values, including array filters.
    const supplied = Object.fromEntries(Object.entries(query.filter || {}).filter(([, value]) => value !== null && value !== undefined));
    const filter = { ...EMPTY_FILTER, ...supplied, party: 'solo' as const };
    return new Set(this.soloRuns.filter((run) => matchesFilter(run, filter)).map((run) => run.id));
  }
  observationsFor(query: ObjectQuery): ObjectObservation[] {
    const runIds = this.scopedRunIds(query);
    return this.observations.filter((event) => event.object.kind === query.kind && (!query.id || event.object.id === query.id) && runIds.has(event.run.id) && (!query.perspective || ['all', 'overall'].includes(query.perspective) || event.character === query.perspective));
  }
  model(kind: ObjectKind, id: string, query: Partial<ObjectQuery> = {}): UnifiedStatisticalObject | null {
    return this.scopedModel(kind, id, query, this.scopedRunIds(query));
  }
  private scopedModel(kind: ObjectKind, id: string, query: Partial<ObjectQuery>, runIds: ReadonlySet<string>): UnifiedStatisticalObject | null {
    const key = objectKey({ kind, id });
    const ref = this.catalogue.get(key);
    if (!ref) return null;
    const events = (this.observationIndex.get(key) || []).filter((event) => runIds.has(event.run.id) && (!query.perspective || ['all', 'overall'].includes(query.perspective) || event.character === query.perspective));
    const characters = careerCharacters({ ...query, kind });
    const conflictingCharacter = Boolean(query.perspective && !['all', 'overall'].includes(query.perspective) && query.filter?.characters?.length && !query.filter.characters.includes(query.perspective));
    const records = (this.career.get(key) || []).filter((record) => record.character === null || (!conflictingCharacter && (!characters.length || characters.includes(record.character))));
    const model = new constructors[kind](ref, events, records);
    model.originSources = [...(this.origins.get(key) || [])];
    if (kind === 'ancient') model.choiceEvents = (this.relatedIndex.get(key) || []).filter((event) => event.object.kind === 'relic' && ['offered', 'picked', 'skipped'].includes(event.event) && event.related.some((related) => objectKey(related) === key) && runIds.has(event.run.id) && (!query.perspective || ['all', 'overall'].includes(query.perspective) || event.character === query.perspective));
    return model;
  }
  objects(query: ObjectQuery): ObjectListResponse {
    const runIds = this.scopedRunIds(query);
    const search = query.search?.trim().toLocaleLowerCase();
    const items: ObjectRow[] = [];
    const poolIDs = cardPoolIDs();
    const pool = query.cardPool ?? (gameCharacters().includes(query.perspective || '') ? query.perspective : 'all');
    for (const ref of this.catalogue.values()) {
      if (ref.kind !== query.kind) continue;
      const cardPool = ref.kind === 'card' ? this.cardPools.get(ref.id) || 'unknown' : undefined;
      if (ref.kind === 'card' && pool !== 'all' && cardPool !== pool) continue;
      const row = this.scopedModel(ref.kind, ref.id, query, runIds)!.row;
      if (query.minimumSample && row.summary.runs > 0 && row.summary.runs < query.minimumSample) continue;
      if (cardPool) row.cardPool = cardPool;
      if (!search || `${row.id} ${row.label}`.toLocaleLowerCase().includes(search)) items.push(row);
    }
    if (query.kind === 'card') {
      for (const cardPool of poolIDs) addObjectNumericFills(items.filter(row => row.cardPool === cardPool));
    } else { addObjectNumericFills(items); }
    const field = query.sort?.field || 'runs';
    const direction = query.sort?.direction === 'asc' ? 1 : -1;
    items.sort((left, right) => {
      if (query.kind === 'card' && pool === 'all' && left.cardPool !== right.cardPool) {
        return poolIDs.indexOf(left.cardPool!) - poolIDs.indexOf(right.cardPool!);
      }
      const value = (row: ObjectRow): string | number | null => {
        if (field.startsWith('metrics.')) return row.metrics?.find(metric => metric.id === field.slice(8))?.value ?? null;
        if (field.startsWith('career.')) return row.careerMetrics?.find(metric => metric.id === field.slice(7))?.value ?? null;
        return field === 'label' || field === 'id' ? row[field] : field === 'careerState' ? row.careerState ?? null : row.summary[field as keyof ObjectSummary] ?? row.metrics?.find((metric) => metric.id === field)?.value ?? row.careerMetrics?.find((metric) => metric.id === field)?.value ?? null;
      };
      const a = value(left), b = value(right);
      if (a === null || b === null) return a === b ? left.id.localeCompare(right.id) : a === null ? 1 : -1;
      return (typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b)) * direction || left.id.localeCompare(right.id);
    });
    const offset = page(query.offset, 0), limit = page(query.limit, 100, 500);
    const columns = [...new Map(items.flatMap(row => [
      ...(row.metrics ?? []).map(metric => ({ ...metric, key: 'metrics.' + metric.id, source: 'run' as const })),
      ...(row.careerMetrics ?? []).map(metric => ({ ...metric, key: 'career.' + metric.id, source: 'career' as const }))
    ]).map(metric => [metric.key, metric])).values()];
    return { kind: query.kind, items: items.slice(offset, offset + limit), total: items.length, offset, limit, scope: scope(query), columns };
  }
  object(query: ObjectQuery): ObjectDetailResponse | null {
    if (!query.id || !OBJECT_KINDS.includes(query.kind)) return null;
    const model = this.scopedModel(query.kind, query.id, query, this.scopedRunIds(query));
    if (!model) return null;
    const related = new Map<string, { ref: ObjectRef; observations: number; runs: Set<string> }>();
    for (const event of model.events) for (const ref of new Map(event.related.map((ref) => [objectKey(ref), ref])).values()) {
      const key = objectKey(ref);
      if (key === objectKey(model.ref)) continue;
      const group = related.get(key) || { ref, observations: 0, runs: new Set<string>() };
      group.observations += 1; group.runs.add(event.run.id); related.set(key, group);
    }
    const runs = model.relatedRuns.sort((a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id));
    const runOffset = page(query.runOffset, 0), runLimit = Math.max(1, page(query.runLimit, 100, 500));
    const evidenceOffset = page(query.evidenceOffset, 0), evidenceLimit = Math.max(1, page(query.evidenceLimit, 100, 500));
    const breakdowns = [model.breakdown('character', '角色', (event) => [event.character]), model.breakdown('floor', '楼层', (event) => event.floor === null ? [] : [String(event.floor)]), model.breakdown('source', '来源', (event) => event.sources), model.breakdown('event', '行为', (event) => [event.event]), model.choices()].filter((table) => table.rows.length);
    if (query.kind === 'card') breakdowns.unshift(...cardHoldingBreakdowns(query.id, runs));
    for (const table of breakdowns) {
      for (const row of table.rows) { row.fills = {}; row.heat = {}; }
      for (const column of table.columns.filter(column => ['number', 'duration', 'percent'].includes(column.format))) {
        const values = table.rows.flatMap(row => {
          const value = row.values[column.id];
          return typeof value === 'number' && Number.isFinite(value) ? [{ row, value }] : [];
        }).sort((a, b) => a.value - b.value);
        const minimum = Math.min(0, values[0]?.value ?? 0);
        const span = (values.at(-1)?.value ?? 0) - minimum;
        let rank = 0;
        values.forEach((entry, index) => {
          if (index > 0 && entry.value !== values[index - 1].value) rank = index;
          entry.row.fills![column.id] = column.format === 'percent' ? Math.max(0, Math.min(1, entry.value)) : values.length > 1 ? rank / (values.length - 1) : 0;
          entry.row.heat![column.id] = span > 0 ? (entry.value - minimum) / span : 0;
        });
      }
    }
    return {
      object: model.row, scope: scope(query), runMetrics: model.metrics(),
      career: { available: model.careerRecords.length > 0, scope: 'lifetime', metrics: model.progress.metrics(model.careerRecords), records: model.careerRecords },
      breakdowns,
      relatedObjects: [...related.entries()].map(([key, group]) => ({ ...identity(group.ref), key, observations: group.observations, runs: group.runs.size })).sort((a, b) => b.observations - a.observations || a.key.localeCompare(b.key)),
      runs: runs.slice(runOffset, runOffset + runLimit).map((run) => ({ id: run.id, character: run.character, status: run.status, floor: run.floor, startTime: run.startTime })), runTotal: runs.length, runOffset, runLimit,
      evidence: model.events.slice(evidenceOffset, evidenceOffset + evidenceLimit).map((event, index) => ({ id: `${objectKey(model.ref)}:${evidenceOffset + index}`, event: event.event, source: event.sources.join(', '), runId: event.run.id, playerIndex: event.playerIndex, character: event.character, floor: event.floor })), evidenceTotal: model.events.length, evidenceOffset, evidenceLimit
    };
  }
}
