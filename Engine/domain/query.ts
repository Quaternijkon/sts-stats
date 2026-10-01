import { wilsonInterval } from './quant.js';
import { zhCharacter, zhEntity, zhMapType, zhStatus } from './i18n.js';
import { itemKindForDimension, runMatchesDataItem, weekId } from './dataItems.js';
import { extractObjectObservations } from './objectObservations.js';
import { classifyCardAvailability } from './preferenceArena.js';
import type {
  AnalysisResult,
  AnalysisRow,
  DataItemRef,
  DimensionDefinition,
  FilterSpec,
  MetricDefinition,
  NormalizedRunV2,
  QueryDataSource,
  QuerySpec
} from './types.js';

type SourceRow = {
  run: NormalizedRunV2;
  entityId?: string;
  floor?: number;
  act?: number;
  event?: Record<string, unknown>;
  player?: Record<string, unknown>;
};

export const METRICS: MetricDefinition[] = [
  { id: 'sample', label: '样本量', description: '符合条件的独立观测数量', grain: 'run', format: 'number', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'], minSamples: 1 },
  { id: 'share', label: '占比', description: '当前分组观测数 / 当前分析全部观测数', grain: 'event', format: 'percent', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'], minSamples: 1 },
  { id: 'wins', label: '胜利数', description: '单人历史样本中的胜场数', grain: 'run', format: 'number', sources: ['runs', 'cards', 'relics', 'players', 'career', 'imported'], minSamples: 1 },
  { id: 'losses', label: '生涯累计失败', description: '单人历史样本中失败且未放弃的局数', grain: 'career', format: 'number', sources: ['career'], minSamples: 1 },
  { id: 'win_rate', label: '胜率', description: '胜利局数 / 已完成游戏局数', grain: 'run', format: 'percent', sources: ['runs', 'cards', 'relics', 'players', 'imported'], minSamples: 5 },
  { id: 'adjusted_win_rate', label: '选择后收缩胜率', description: '实际选择该实体的唯一已完成对局向当前分析基线收缩后的胜率', grain: 'event', format: 'percent', sources: ['cards', 'relics'], minSamples: 5 },
  { id: 'baseline_delta', label: '选择后基线差', description: '选择后收缩胜率相对当前样本基线的差异', grain: 'event', format: 'percent', sources: ['cards', 'relics'], minSamples: 5 },
  { id: 'ci_low', label: '胜率 95% 下界', description: '当前分组唯一已完成对局胜率的 Wilson 95% 区间下界；选择数据源仅统计实际选择记录', grain: 'event', format: 'percent', sources: ['runs', 'cards', 'relics', 'imported'], minSamples: 5 },
  { id: 'ci_high', label: '胜率 95% 上界', description: '当前分组唯一已完成对局胜率的 Wilson 95% 区间上界；选择数据源仅统计实际选择记录', grain: 'event', format: 'percent', sources: ['runs', 'cards', 'relics', 'imported'], minSamples: 5 },
  { id: 'avg_floor', label: '平均到达层', description: '游戏结束时到达楼层的均值', grain: 'run', format: 'floors', sources: ['runs', 'cards', 'relics', 'players', 'imported'], minSamples: 3 },
  { id: 'avg_duration', label: '平均局时', description: '每局游戏时间均值', grain: 'run', format: 'duration', sources: ['runs', 'cards', 'relics', 'players', 'imported'], minSamples: 3 },
  { id: 'avg_damage', label: '平均承伤', description: '每局或事件的平均承伤', grain: 'event', format: 'number', sources: ['runs', 'encounters', 'floors', 'players', 'imported'], minSamples: 3 },
  { id: 'avg_gold', label: '平均金币', description: '终局或节点金币均值', grain: 'run', format: 'number', sources: ['runs', 'floors', 'players', 'imported'], minSamples: 3 },
  { id: 'avg_deck_size', label: '平均牌组规模', description: '终局牌组卡牌数量均值', grain: 'run', format: 'number', sources: ['runs', 'cards', 'players', 'imported'], minSamples: 3 },
  { id: 'hp', label: '生命值', description: '节点结束时生命值', grain: 'event', format: 'number', sources: ['floors'], minSamples: 1 },
  { id: 'gold', label: '金币', description: '节点结束时金币', grain: 'event', format: 'number', sources: ['floors'], minSamples: 1 },
  { id: 'damage_taken', label: '节点承伤', description: '该节点受到的伤害', grain: 'event', format: 'number', sources: ['floors'], minSamples: 1 },
  { id: 'survival_rate', label: '生存率', description: '遭遇战后玩家仍存活的比例', grain: 'event', format: 'percent', sources: ['encounters', 'floors'], minSamples: 5 },
  { id: 'offered', label: '被提供', description: '该实体作为可选项出现的次数', grain: 'event', format: 'number', sources: ['cards', 'relics'], minSamples: 1 },
  { id: 'picked', label: '被选择', description: '该实体被玩家选择的次数', grain: 'event', format: 'number', sources: ['cards', 'relics'], minSamples: 1 },
  { id: 'pick_rate', label: '原始选择率', description: '实体被选择次数 / 被提供次数', grain: 'event', format: 'percent', sources: ['cards', 'relics'], minSamples: 5 },
  { id: 'adjusted_pick_rate', label: '收缩选择率', description: '向当前候选样本总体选择率收缩的小样本估计', grain: 'event', format: 'percent', sources: ['cards', 'relics'], minSamples: 5 },
  { id: 'pick_ci_low', label: '选择率 95% 下界', description: '选择次数 / 提供次数的 Wilson 95% 区间下界', grain: 'event', format: 'percent', sources: ['cards', 'relics'], minSamples: 5 },
  { id: 'pick_ci_high', label: '选择率 95% 上界', description: '选择次数 / 提供次数的 Wilson 95% 区间上界', grain: 'event', format: 'percent', sources: ['cards', 'relics'], minSamples: 5 },
  { id: 'runs_with', label: '持有局数', description: '最终持有该遗物的唯一游戏局数', grain: 'run', format: 'number', sources: ['relics'], minSamples: 1 },
  { id: 'win_rate_with', label: '持有胜率', description: '最终持有该遗物的已完成游戏胜率', grain: 'run', format: 'percent', sources: ['relics'], minSamples: 5 }
];

export const DIMENSIONS: DimensionDefinition[] = [
  { id: 'character', label: '角色', description: '游戏局主角色', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'career', 'imported'] },
  { id: 'build', label: '版本', description: '游戏构建版本', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'ascension', label: '进阶', description: '游戏进阶等级', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'outcome', label: '结果', description: '胜利、失败或放弃', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'party', label: '队伍类型', description: '单人或多人合作', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'mode', label: '游戏模式', description: '标准、挑战或其他存档记录的模式', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'date', label: '日期', description: '游戏开始日期', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'week', label: '周', description: '游戏开始周', grain: 'run', sources: ['runs', 'cards', 'relics', 'encounters', 'floors', 'players', 'imported'] },
  { id: 'entity', label: '实体', description: '卡牌、遗物或遭遇战标识', grain: 'event', sources: ['cards', 'relics', 'encounters'] },
  { id: 'floor', label: '楼层', description: '选择、获取、节点或遭遇战所在楼层', grain: 'event', sources: ['cards', 'relics', 'encounters', 'floors'] },
  { id: 'act', label: '阶段', description: '节点所在阶段', grain: 'event', sources: ['encounters', 'floors'] },
  { id: 'room_type', label: '房间类型', description: '地图节点的房间类型', grain: 'event', sources: ['floors'] },
  { id: 'player_position', label: '玩家位次', description: '多人队伍中的记录位次', grain: 'player', sources: ['players'] }
];

export function metricFor(id: string) {
  return METRICS.find((metric) => metric.id === id);
}

export function dimensionFor(id: string) {
  return DIMENSIONS.find((dimension) => dimension.id === id);
}

export function compatibilityReason(source: QueryDataSource, metricId: string, dimensionIds: string[]): string | null {
  const metric = metricFor(metricId);
  if (!metric?.sources.includes(source)) return '该指标不支持当前数据源';
  const invalidDimension = dimensionIds.map(dimensionFor).find((dimension) => !dimension?.sources.includes(source));
  if (invalidDimension) return `${invalidDimension.label}与当前数据源粒度不兼容`;
  if (['offered', 'picked', 'pick_rate', 'adjusted_pick_rate', 'pick_ci_low', 'pick_ci_high', 'runs_with', 'win_rate_with'].includes(metricId) && !dimensionIds.includes('entity')) return '该指标必须按实体分组';
  return null;
}

function dateBoundary(value: string | null, end = false): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}T${end ? '23:59:59' : '00:00:00'}`);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function ids(items: Array<string | { id?: string }> | undefined): string[] {
  return (items || []).map((item) => typeof item === 'string' ? item : item.id || '').filter(Boolean);
}

export function matchesFilter(run: NormalizedRunV2, filter: FilterSpec): boolean {
  const from = dateBoundary(filter.dateFrom);
  const to = dateBoundary(filter.dateTo, true);
  const deckIds = ids(run.deck);
  const relicIds = [...new Set([...ids(run.relics), ...(run.relicEvents || [])])];
  if (filter.mode.length && !filter.mode.includes((run.gameMode || 'standard').toLowerCase())) return false;
  if (filter.characters.length && !filter.characters.includes(run.character)) return false;
  if (filter.builds.length && !filter.builds.includes(run.buildId || 'unknown')) return false;
  if (filter.ascensions.length && !filter.ascensions.includes(run.ascension)) return false;
  if (filter.party === 'solo' && (run.isMultiplayer || run.playerCount > 1 || run.players.length > 1)) return false;
  if (filter.party === 'coop' && !(run.isMultiplayer || run.playerCount > 1 || run.players.length > 1)) return false;
  if (filter.outcomes.length && !filter.outcomes.includes(run.status)) return false;
  if (run.status === 'abandoned') {
    if (filter.abandonPolicy === 'exclude-all') return false;
    if (filter.abandonPolicy === 'exclude-short' && run.runTime < (filter.shortAbandonMinutes ?? 5) * 60) return false;
  }
  if (from !== null && run.startTime < from) return false;
  if (to !== null && run.startTime > to) return false;
  if (filter.minDuration !== null && run.runTime < filter.minDuration) return false;
  if (filter.maxDuration !== null && run.runTime > filter.maxDuration) return false;
  if (filter.includeCards.some((id) => !deckIds.includes(id))) return false;
  if (filter.excludeCards.some((id) => deckIds.includes(id))) return false;
  if (filter.includeRelics.some((id) => !relicIds.includes(id))) return false;
  if (filter.excludeRelics.some((id) => relicIds.includes(id))) return false;
  return true;
}

function toSourceRows(runs: NormalizedRunV2[], source: QueryDataSource): SourceRow[] {
  if (source === 'runs' || source === 'imported' || source === 'career') return runs.map((run) => ({ run }));
  if (source === 'players') return runs.flatMap((run) => (run.players || []).map((player, index) => ({ run, player: { ...player, position: index + 1 } })));
  const kind = ({ cards: 'card', relics: 'relic', encounters: 'encounter', floors: 'floor' } as const)[source];
  if (!kind) return [];
  const evidence = extractObjectObservations(runs).filter((event) => event.object.kind === kind);
  if (source === 'cards' || source === 'relics') {
    const rows: SourceRow[] = [];
    const choiceKey = (event: typeof evidence[number]) => JSON.stringify([event.run.id, event.playerIndex, event.floor, event.object.id]);
    const picked = new Map<string, number>();
    for (const event of evidence.filter((row) => row.event === 'picked')) picked.set(choiceKey(event), (picked.get(choiceKey(event)) || 0) + 1);
    const represented = new Set<string>();
    for (const event of evidence.filter((row) => row.event === 'offered')) {
      const key = choiceKey(event), selected = picked.get(key) || 0;
      if (selected) picked.set(key, selected - 1);
      represented.add(`${event.run.id}:${event.object.id}`);
      rows.push({ run: event.run, entityId: event.object.id, floor: event.floor ?? undefined, act: event.act ?? undefined, event: { offered: true, picked: selected > 0 } });
    }
    // Possession is supported only by the final inventory. A removed item is
    // represented by its acquisition evidence without being relabeled held.
    for (const event of evidence.filter((row) => row.event === 'held')) {
      const key = `${event.run.id}:${event.object.id}`;
      if (source === 'relics' || !represented.has(key)) rows.push({ run: event.run, entityId: event.object.id, event: { held: true } });
      represented.add(key);
    }
    for (const event of evidence) {
      const key = `${event.run.id}:${event.object.id}`;
      if (represented.has(key)) continue;
      rows.push({ run: event.run, entityId: event.object.id, floor: event.floor ?? undefined, act: event.act ?? undefined, event: { [event.event]: true } });
      represented.add(key);
    }
    return rows;
  }
  return evidence.filter((event) => event.event === (source === 'encounters' ? 'fought' : 'recorded')).map((event) => ({
    run: event.run, entityId: source === 'encounters' ? event.object.id : undefined,
    floor: event.floor ?? undefined, act: event.act ?? undefined, event: { ...event.telemetry, type: event.related.find(ref => ref.kind === 'roomType')?.id }
  }));
}

type DimensionValue = {
  id: string;
  label: string;
  item: DataItemRef | null;
};

function dimensionValue(row: SourceRow, id: string, source: QueryDataSource): DimensionValue {
  const run = row.run;
  const kind = itemKindForDimension(source, id);
  const result = (value: string, label: string): DimensionValue => ({
    id: value,
    label,
    item: kind ? { kind, id: value, label } : null
  });
  if (id === 'character') {
    const raw = String(row.player?.character || run.character || 'Unknown');
    return result(raw, zhCharacter(raw));
  }
  if (id === 'build') return result(run.buildId || 'unknown', run.buildId || '未知版本');
  if (id === 'ascension') return result(String(run.ascension), `A${run.ascension}`);
  if (id === 'outcome') return result(run.status, zhStatus(run.status));
  if (id === 'party') return result(run.isMultiplayer ? 'coop' : 'solo', run.isMultiplayer ? '多人合作' : '单人');
  if (id === 'mode') return result((run.gameMode || 'standard').toLowerCase(), run.gameMode || '标准');
  if (id === 'date') {
    const value = new Date(run.startTime * 1000).toISOString().slice(0, 10);
    return result(value, value);
  }
  if (id === 'week') {
    const value = weekId(run.startTime);
    return result(value, value);
  }
  if (id === 'entity') {
    const raw = row.entityId || 'Unknown';
    const category = source === 'cards' ? 'cards' : source === 'relics' ? 'relics' : 'encounters';
    return result(raw, zhEntity(raw, category));
  }
  if (id === 'floor') return result(String(row.floor || 0), `${row.floor || 0} 层`);
  if (id === 'act') return result(String(row.act || 0), `第 ${row.act || 0} 阶段`);
  if (id === 'room_type') {
    const raw = String(row.event?.type || 'unknown').toLowerCase();
    return result(raw, zhMapType(raw));
  }
  if (id === 'player_position') return result(String(row.player?.position || 1), `玩家 ${row.player?.position || 1}`);
  return { id: 'all', label: '总体', item: null };
}

function numeric(values: unknown[]): number[] {
  return values.filter((value) => value !== undefined && value !== null).map(Number).filter(Number.isFinite);
}

function mean(values: unknown[]): number {
  const clean = numeric(values);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function observedMean(values: unknown[]): number | null {
  const clean = numeric(values);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function metricValue(metricId: string, rows: SourceRow[], allRows: SourceRow[]): number | null {
  if (metricId === 'sample') return rows.length;
  if (metricId === 'share') return allRows.length ? rows.length / allRows.length : 0;
  if (metricId === 'losses') return new Set(rows.filter((row) => !row.run.win && row.run.status !== 'abandoned').map((row) => row.run.id)).size;
  if (metricId === 'wins') return new Set(rows.filter((row) => row.run.win).map((row) => row.run.id)).size;
  if (metricId === 'win_rate') {
    const unique = [...new Map(rows.map((row) => [row.run.id, row.run])).values()].filter((run) => run.status !== 'abandoned');
    return unique.length ? unique.filter((run) => run.win).length / unique.length : null;
  }
  if (['adjusted_win_rate', 'baseline_delta', 'ci_low', 'ci_high'].includes(metricId)) {
    const selectedRows = rows.some((row) => row.event?.offered === true) ? rows.filter((row) => row.event?.picked === true) : rows;
    const unique = [...new Map(selectedRows.map((row) => [row.run.id, row.run])).values()].filter((run) => run.status !== 'abandoned');
    const allUnique = [...new Map(allRows.map((row) => [row.run.id, row.run])).values()].filter((run) => run.status !== 'abandoned');
    const wins = unique.filter((run) => run.win).length;
    if (!unique.length) return null;
    const baseline = allUnique.length ? allUnique.filter((run) => run.win).length / allUnique.length : 0;
    const adjusted = unique.length ? (wins + baseline * 10) / (unique.length + 10) : baseline;
    const interval = wilsonInterval(wins, unique.length);
    if (metricId === 'adjusted_win_rate') return adjusted;
    if (metricId === 'baseline_delta') return adjusted - baseline;
    return metricId === 'ci_low' ? interval.low : interval.high;
  }
  if (metricId === 'avg_floor') return mean([...new Map(rows.map((row) => [row.run.id, row.run.floor])).values()]);
  if (metricId === 'avg_duration') return mean([...new Map(rows.map((row) => [row.run.id, row.run.runTime])).values()]);
  if (metricId === 'avg_damage') return rows[0]?.event ? observedMean(rows.map((row) => row.event?.damageTaken)) : mean([...new Map(rows.map((row) => [row.run.id, row.run.totalDamageTaken])).values()]);
  if (metricId === 'avg_gold') return rows[0]?.event ? observedMean(rows.map((row) => row.event?.gold ?? row.event?.current_gold)) : mean([...new Map(rows.map((row) => [row.run.id, row.run.gold])).values()]);
  if (metricId === 'avg_deck_size') return mean([...new Map(rows.map((row) => [row.run.id, row.run.deckSize])).values()]);
  if (metricId === 'hp') return observedMean(rows.map((row) => row.event?.hp));
  if (metricId === 'gold') return observedMean(rows.map((row) => row.event?.gold));
  if (metricId === 'damage_taken') return observedMean(rows.map((row) => row.event?.damageTaken));
  if (metricId === 'survival_rate') {
    const known = rows.filter((row) => typeof row.event?.killedPlayer === 'boolean' || typeof row.event?.hp === 'number');
    return known.length ? known.filter((row) => row.event?.killedPlayer !== true && Number(row.event?.hp ?? 1) > 0).length / known.length : null;
  }
  if (metricId === 'offered') return rows.filter((row) => row.event?.offered === true).length;
  if (metricId === 'picked') return rows.filter((row) => row.event?.picked === true).length;
  if (metricId === 'pick_rate') {
    const offered = rows.filter((row) => row.event?.offered === true);
    return offered.length ? offered.filter((row) => row.event?.picked === true).length / offered.length : null;
  }
  if (['adjusted_pick_rate', 'pick_ci_low', 'pick_ci_high'].includes(metricId)) {
    const offered = rows.filter((row) => row.event?.offered === true);
    const picked = offered.filter((row) => row.event?.picked === true).length;
    if (!offered.length) return null;
    const allOffered = allRows.filter((row) => row.event?.offered === true);
    const allPicked = allOffered.filter((row) => row.event?.picked === true).length;
    const baseline = allOffered.length ? allPicked / allOffered.length : 0;
    if (metricId === 'adjusted_pick_rate') return offered.length ? (picked + baseline * 10) / (offered.length + 10) : baseline;
    const interval = wilsonInterval(picked, offered.length);
    return metricId === 'pick_ci_low' ? interval.low : interval.high;
  }
  if (metricId === 'runs_with') return new Set(rows.filter((row) => row.event?.held === true).map((row) => row.run.id)).size;
  if (metricId === 'win_rate_with') {
    const held = [...new Map(rows.filter((row) => row.event?.held === true).map((row) => [row.run.id, row.run])).values()].filter((run) => run.status !== 'abandoned');
    return held.length ? held.filter((run) => run.win).length / held.length : null;
  }
  return 0;
}

function analyzeRows(sourceRows: SourceRow[], query: QuerySpec, cohort?: 'A' | 'B'): AnalysisRow[] {
  const groups = new Map<string, { label: string; items: DataItemRef[]; rows: SourceRow[] }>();
  for (const row of sourceRows) {
    const parts = query.dimensionIds.map((dimension) => dimensionValue(row, dimension, query.dataSource));
    const key = parts.length ? parts.map((part) => part.id).join('¦') : 'all';
    const label = parts.length ? parts.map((part) => part.label).join(' · ') : '总体';
    const group = groups.get(key) || { label, items: parts.flatMap((part) => part.item ? [part.item] : []), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key: cohort ? `${cohort}:${key}` : key,
    label: group.label,
    sample: group.rows.length,
    values: Object.fromEntries(query.metricIds.map((metric) => [metric, metricValue(metric, group.rows, sourceRows)])),
    cohort,
    items: group.items,
    drilldownIds: [...new Set(group.rows.map((row) => row.run.id))]
  }));
}

function combineFilters(base: FilterSpec, additional: FilterSpec): FilterSpec {
  const intersection = <T,>(a: T[], b: T[]) => {
    const values = a.length && b.length ? a.filter((value) => b.includes(value)) : (b.length ? b : a);
    return { values, conflict: Boolean(a.length && b.length && !values.length) };
  };
  const mode = intersection(base.mode, additional.mode);
  const characters = intersection(base.characters, additional.characters);
  const builds = intersection(base.builds, additional.builds);
  const ascensions = intersection(base.ascensions, additional.ascensions);
  const outcomes = intersection(base.outcomes, additional.outcomes);
  const conflict = mode.conflict || characters.conflict || builds.conflict || ascensions.conflict || outcomes.conflict;
  return {
    mode: conflict ? ['__NO_MATCH__'] : mode.values,
    characters: characters.values,
    builds: builds.values,
    ascensions: ascensions.values,
    party: additional.party !== 'all' ? additional.party : base.party,
    outcomes: outcomes.values,
    abandonPolicy: base.abandonPolicy === 'exclude-all' || additional.abandonPolicy === 'exclude-all' ? 'exclude-all'
      : base.abandonPolicy === 'exclude-short' || additional.abandonPolicy === 'exclude-short' ? 'exclude-short' : 'include',
    shortAbandonMinutes: Math.max(base.abandonPolicy === 'exclude-short' ? (base.shortAbandonMinutes ?? 5) : 0,
      additional.abandonPolicy === 'exclude-short' ? (additional.shortAbandonMinutes ?? 5) : 0) || 5,
    dateFrom: additional.dateFrom || base.dateFrom,
    dateTo: additional.dateTo || base.dateTo,
    minDuration: additional.minDuration ?? base.minDuration,
    maxDuration: additional.maxDuration ?? base.maxDuration,
    includeCards: [...new Set([...base.includeCards, ...additional.includeCards])],
    excludeCards: [...new Set([...base.excludeCards, ...additional.excludeCards])],
    includeRelics: [...new Set([...base.includeRelics, ...additional.includeRelics])],
    excludeRelics: [...new Set([...base.excludeRelics, ...additional.excludeRelics])]
  };
}

export function executeQuery(runs: NormalizedRunV2[], query: QuerySpec): AnalysisResult {
  runs = [...new Map(runs.filter((run) => !run.isMultiplayer && run.playerCount <= 1 && run.players.length <= 1).map((run) => [run.id, run])).values()];
  query = { ...query, filter: { ...query.filter, party: 'solo' },
    cohorts: query.cohorts?.map((cohort) => ({ ...cohort, filter: { ...cohort.filter, party: 'solo' } })) };
  let unscopedPool = query.dataSource === 'imported' ? runs.filter((run) => run.sourceScope === 'imported') : runs.filter((run) => run.sourceScope !== 'imported');
  if (query.dataSource === 'cards' && query.cardCategory && query.cardCategory !== 'all' && query.cardCategory !== 'colorless') {
    unscopedPool = unscopedPool.filter((run) => run.character === query.cardCategory);
  }
  const focuses = query.focuses?.length ? query.focuses : query.focus ? [query.focus] : [];
  const sourcePool = focuses.length ? unscopedPool.filter((run) => focuses.every((item) => runMatchesDataItem(run, item))) : unscopedPool;
  const baseRuns = sourcePool.filter((run) => matchesFilter(run, query.filter));
  let rows: AnalysisRow[];
  let cohortRunGroups: NormalizedRunV2[][] = [];
  if (query.cohorts?.length) {
    cohortRunGroups = query.cohorts.map((cohort) => sourcePool.filter((run) => matchesFilter(run, combineFilters(query.filter, cohort.filter))));
    rows = query.cohorts.flatMap((cohort, index) => analyzeRows(toSourceRows(cohortRunGroups[index], query.dataSource), query, cohort.id));
  } else {
    rows = analyzeRows(toSourceRows(baseRuns, query.dataSource), query);
  }

  for (const sort of [...query.sort].reverse()) {
    rows.sort((a, b) => {
      const av = sort.field === 'label' ? a.label : Number(a.values[sort.field] ?? a.sample);
      const bv = sort.field === 'label' ? b.label : Number(b.values[sort.field] ?? b.sample);
      const order = typeof av === 'string' ? av.localeCompare(String(bv), 'zh-CN') : av - Number(bv);
      return sort.direction === 'asc' ? order : -order;
    });
  }
  if (query.dataSource === 'cards' && query.cardCategory === 'colorless') {
    const colorlessIds = new Set(classifyCardAvailability(unscopedPool).colorlessIds);
    rows = rows.filter((row) => colorlessIds.has(row.key));
  }
  rows = rows.slice(0, query.limit);
  const eligibleRuns = query.cohorts?.length ? cohortRunGroups.flat() : baseRuns;
  const uniqueRuns = new Set(eligibleRuns.map((run) => run.id));
  const wins = baseRuns.filter((run) => run.win).length;
  const interval = wilsonInterval(wins, baseRuns.filter((run) => run.status !== 'abandoned').length);
  const sample = uniqueRuns.size;
  const reliabilitySample = query.cohorts?.length ? Math.min(...cohortRunGroups.map((group) => group.length)) : sample;
  const minRequired = Math.max(...query.metricIds.map((id) => metricFor(id)?.minSamples || 1));
  const warnings: string[] = [];
  if (sample < minRequired) warnings.push(`当前仅 ${sample} 局，低于建议样本量 ${minRequired}；结果仅作描述性参考。`);
  if (query.dataSource === 'cards' || query.dataSource === 'relics') warnings.push('实体效果为描述性关联，不代表因果关系。');
  if (query.cohorts?.length && cohortRunGroups.some((group) => group.length < minRequired)) {
    warnings.push('至少一个对照组样本不足，已降低结论可靠度。');
  }
  return {
    rows,
    sample: { total: sourcePool.length, eligible: sample, excluded: sourcePool.length - sample },
    confidence: [{ key: 'win_rate', low: interval.low, high: interval.high }],
    reliability: reliabilitySample >= 30 ? 'strong' : reliabilitySample >= 10 ? 'moderate' : 'limited',
    warnings,
    query,
    generatedAt: Date.now(),
    scope: 'personal'
  };
}

export function executeCareerQuery(runs: NormalizedRunV2[], query: QuerySpec): AnalysisResult {
  return executeQuery(runs, query);
}

export function exportAnalysisCsv(result: AnalysisResult): string {
  const metrics = result.query.metricIds;
  const header = ['cohort', 'label', 'sample', ...metrics];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [header, ...result.rows.map((row) => [row.cohort || '', row.label, row.sample, ...metrics.map((metric) => row.values[metric] ?? '')])]
    .map((row) => row.map(escape).join(','))
    .join('\n');
}

export function sourceLabel(source: QueryDataSource): string {
  return ({ runs: '历史单局样本', cards: '卡牌选择', relics: '遗物持有', encounters: '遭遇战', floors: '楼层节点', players: '玩家记录', career: '单人生涯记录', imported: '导入记录' })[source];
}

export function eventTypeLabel(value: string): string {
  return zhMapType(value);
}
