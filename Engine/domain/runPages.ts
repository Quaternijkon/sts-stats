import { buildPlayerTimeline } from './parser';
import { zhCharacter, zhGameMode } from './i18n';
import type { NormalizedRunV2, TimelinePoint } from './types';

export interface RunPageRequest {
  coop?: boolean;
  search?: string;
  favorites?: string[] | null;
  sort?: { field: string; direction: string };
  offset?: number;
  limit?: number;
}

export interface CoopTelemetry {
  id: string;
  runId: string;
  character: string;
  characterId: string;
  position: number;
  lowHpNodes: number | null;
  hpSamples: number;
  nodes: number;
  damage: number | null;
  healed: number | null;
  damageSamples: number;
  healedSamples: number;
  fills?: Record<string, number>;
  heat?: Record<string, number>;
}

export interface CoopComposition {
  id: string;
  label: string;
  sample: number;
  completed: number;
  winRate: number | null;
  fills?: Record<string, number>;
  heat?: Record<string, number>;
}

export interface RunPageResponse {
  runs: NormalizedRunV2[];
  total: number;
  offset: number;
  limit: number;
  compositions?: CoopComposition[];
  telemetry?: CoopTelemetry[];
  telemetryTotal?: number;
  fills: Record<string, Record<string, number>>;
  heat: Record<string, Record<string, number>>;
}

/** Rebuild from recorded maps, but retain normalized timelines in imported datasets. */
export function playerTimeline(run: NormalizedRunV2, index = 0): TimelinePoint[] {
  const rebuilt = buildPlayerTimeline(run, index) as TimelinePoint[];
  if (rebuilt.length) return rebuilt;
  const normalized = run.playerTimelines?.[index];
  if (normalized?.length) return normalized;
  return index === 0 ? run.timeline ?? [] : normalized ?? [];
}

export function runSummary(run: NormalizedRunV2): NormalizedRunV2 {
  const { raw: _raw, map: _map, timeline: _timeline, playerTimelines: _timelines, ...summary } = run;
  return summary as NormalizedRunV2;
}

function recorded(point: TimelinePoint, field: string): number | null {
  const value = point[field];
  return point.recordedFields?.includes(field) && typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scales<T extends { id: string }>(rows: T[], fields: string[], value: (row: T, field: string) => unknown) {
  const fills: Record<string, Record<string, number>> = Object.fromEntries(rows.map(row => [row.id, {}]));
  const heat: Record<string, Record<string, number>> = Object.fromEntries(rows.map(row => [row.id, {}]));
  for (const field of fields) {
    const values = rows.flatMap(row => {
      const number = value(row, field);
      return typeof number === 'number' && Number.isFinite(number) ? [{ row, number }] : [];
    }).sort((a, b) => a.number - b.number);
    const minimum = Math.min(0, values[0]?.number ?? 0);
    const span = (values.at(-1)?.number ?? 0) - minimum;
    let rank = 0;
    values.forEach((entry, index) => {
      if (index > 0 && entry.number !== values[index - 1].number) rank = index;
      fills[entry.row.id][field] = field === 'winRate' ? Math.max(0, Math.min(1, entry.number)) : values.length > 1 ? rank / (values.length - 1) : 0;
      heat[entry.row.id][field] = span > 0 ? (entry.number - minimum) / span : 0;
    });
  }
  return { fills, heat };
}

export function coopSummary(runs: NormalizedRunV2[]) {
  const groups = new Map<string, NormalizedRunV2[]>();
  const telemetry: CoopTelemetry[] = [];
  for (const run of runs) {
    const key = run.players.map(player => player.character).sort().join(' + ');
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
    run.players.forEach((player, index) => {
      const points = playerTimeline(run, index);
      const hp = points.filter(point => recorded(point, 'hp') !== null && (recorded(point, 'maxHp') ?? 0) > 0);
      const damage = points.flatMap(point => { const value = recorded(point, 'damageTaken'); return value === null ? [] : [value]; });
      const healed = points.flatMap(point => { const value = recorded(point, 'hpHealed'); return value === null ? [] : [value]; });
      telemetry.push({
        id: `${run.id}:${index}`, runId: run.id, character: zhCharacter(player.character), characterId: player.character,
        position: index + 1, nodes: points.length, hpSamples: hp.length,
        lowHpNodes: hp.length ? hp.filter(point => point.hp / point.maxHp < 0.25).length : null,
        damage: damage.length ? damage.reduce((sum, value) => sum + value, 0) : null,
        healed: healed.length ? healed.reduce((sum, value) => sum + value, 0) : null,
        damageSamples: damage.length, healedSamples: healed.length,
      });
    });
  }
  const compositions: CoopComposition[] = [...groups].map(([id, group]) => {
    const completed = group.filter(run => run.status !== 'abandoned');
    return { id, label: group[0].players.map(player => zhCharacter(player.character)).sort().join(' + '), sample: group.length, completed: completed.length, winRate: completed.length ? completed.filter(run => run.win).length / completed.length : null };
  }).sort((a, b) => b.sample - a.sample || a.id.localeCompare(b.id));
  for (const [rows, fields] of [[telemetry, ['position', 'lowHpNodes', 'nodes', 'damage', 'healed']], [compositions, ['sample', 'winRate']]] as const) {
    const typedRows = rows as Array<CoopTelemetry | CoopComposition>;
    const numeric = scales(typedRows, [...fields], (row, field) => (row as unknown as Record<string, unknown>)[field]);
    for (const row of typedRows) { row.fills = numeric.fills[row.id]; row.heat = numeric.heat[row.id]; }
  }
  return { telemetry, compositions };
}

/** Search, ranks and composition totals use the entire filtered set before paging. */
export function runPage(pool: NormalizedRunV2[], request: RunPageRequest): RunPageResponse {
  const search = String(request.search ?? '').trim().toLocaleLowerCase();
  const favorites = Array.isArray(request.favorites) ? new Set(request.favorites) : null;
  const runs = pool.filter(run => {
    if (favorites && !favorites.has(run.id)) return false;
    if (!search) return true;
    const date = new Date(run.startTime * 1000);
    const localized = [zhCharacter(run.character), ...run.players.map(player => zhCharacter(player.character)), run.status === 'win' ? '胜利' : run.status === 'loss' ? '失败' : '放弃', zhGameMode(run.gameMode), Number.isFinite(date.valueOf()) ? date.toLocaleDateString('zh-CN') : ''];
    return `${JSON.stringify(runSummary(run))} ${localized.join(' ')}`.toLocaleLowerCase().includes(search);
  });
  const field = request.sort?.field ?? 'startTime';
  const direction = request.sort?.direction === 'asc' ? 1 : -1;
  const sortValue = (run: NormalizedRunV2) => field === 'character' ? zhCharacter(run.character) : run[field];
  runs.sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    if (left == null || right == null) return left == null && right == null ? a.id.localeCompare(b.id) : left == null ? 1 : -1;
    return (typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right, 'zh-CN') : Number(left) - Number(right)) * direction || a.id.localeCompare(b.id);
  });
  const offset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset!)) : 0;
  const limit = Number.isFinite(request.limit) ? Math.max(1, Math.min(500, Math.floor(request.limit!))) : 100;
  const numeric = scales(runs, ['ascension', 'floor', 'runTime', 'deckSize', 'relicCount', 'playerCount', 'totalDamageTaken'], (run, column) => run[column]);
  const visible = runs.slice(offset, offset + limit);
  const visibleIds = new Set(visible.map(run => run.id));
  const coop = request.coop ? coopSummary(runs) : null;
  return {
    runs: visible.map(runSummary), total: runs.length, offset, limit,
    fills: Object.fromEntries(visible.map(run => [run.id, numeric.fills[run.id]])),
    heat: Object.fromEntries(visible.map(run => [run.id, numeric.heat[run.id]])),
    ...(coop ? { compositions: coop.compositions, telemetry: coop.telemetry.filter(row => visibleIds.has(row.runId)), telemetryTotal: coop.telemetry.length } : {}),
  };
}
