import { zhCharacter, zhEntity, zhGameMode, zhMapType, zhStatus } from './i18n.js';
import type { DataItemKind, DataItemRef, NormalizedRunV2, QueryDataSource } from './types.js';
import { extractObjectObservations } from './objectObservations.js';

export const DATA_ITEM_META: Record<DataItemKind, { singular: string; plural: string; path: string | null }> = {
  card: { singular: '卡牌', plural: '卡牌', path: 'cards' },
  relic: { singular: '遗物', plural: '遗物', path: 'relics' },
  encounter: { singular: '遭遇战', plural: '遭遇战', path: 'encounters' },
  ancient: { singular: '先古之民', plural: '先古之民', path: 'ancients' },
  potion: { singular: '药水', plural: '药水', path: 'potions' },
  event: { singular: '事件', plural: '事件', path: 'events' },
  enemy: { singular: '敌人', plural: '敌人', path: 'enemies' },
  enchantment: { singular: '附魔', plural: '附魔', path: 'enchantments' },
  quest: { singular: '任务', plural: '任务', path: 'quests' },
  restChoice: { singular: '休息处选项', plural: '休息处选项', path: 'rest-choices' },
  badge: { singular: '徽章', plural: '徽章', path: 'badges' },
  epoch: { singular: '解锁进度', plural: '解锁进度', path: 'epochs' },
  achievement: { singular: '成就', plural: '成就', path: 'achievements' },
  location: { singular: '地点', plural: '地点', path: 'locations' },
  modifier: { singular: '特效', plural: '特效', path: 'modifiers' },
  run: { singular: '游戏记录', plural: '游戏记录', path: 'runs' },
  character: { singular: '角色', plural: '角色', path: 'characters' },
  build: { singular: '版本', plural: '版本', path: 'builds' },
  ascension: { singular: '进阶', plural: '进阶', path: 'ascensions' },
  outcome: { singular: '结果', plural: '结果', path: 'outcomes' },
  party: { singular: '队伍', plural: '队伍', path: 'parties' },
  gameMode: { singular: '游戏模式', plural: '游戏模式', path: 'modes' },
  floor: { singular: '楼层', plural: '楼层', path: 'floors' },
  act: { singular: '阶段', plural: '阶段', path: 'acts' },
  date: { singular: '日期', plural: '日期', path: 'dates' },
  week: { singular: '周', plural: '周', path: 'weeks' },
  playerPosition: { singular: '玩家位次', plural: '玩家位次', path: 'player-positions' },
  roomType: { singular: '房间类型', plural: '房间类型', path: 'room-types' }
};

export const FACET_ITEM_KINDS = [
  'character', 'build', 'ascension', 'outcome', 'party', 'gameMode',
  'floor', 'act', 'date', 'week', 'playerPosition', 'roomType'
] as const satisfies readonly DataItemKind[];

export type FacetItemKind = typeof FACET_ITEM_KINDS[number];

export function isDataItemKind(value: string): value is DataItemKind {
  return Object.hasOwn(DATA_ITEM_META, value);
}

export function isFacetItemKind(value: string): value is FacetItemKind {
  return (FACET_ITEM_KINDS as readonly string[]).includes(value);
}

export function dataItemLabel(item: DataItemRef): string {
  if (item.label) return item.label;
  const { kind, id } = item;
  if (kind === 'card') return zhEntity(id, 'cards', id);
  if (kind === 'relic') return zhEntity(id, 'relics', id);
  if (kind === 'encounter') return zhEntity(id, 'encounters', id);
  if (kind === 'ancient') return zhEntity(id, 'ancients', id);
  const category = ({ potion: 'potions', event: 'events', enemy: 'monsters', enchantment: 'enchantments', quest: 'cards', restChoice: 'rest_site_ui', badge: 'badges', epoch: 'epochs', achievement: 'achievements', location: 'acts', modifier: 'modifiers' } as Record<string, string>)[kind];
  if (category) return zhEntity(id, category, id);
  if (kind === 'character') return zhCharacter(id);
  if (kind === 'outcome') return zhStatus(id);
  if (kind === 'gameMode') return zhGameMode(id);
  if (kind === 'ascension') return `A${id}`;
  if (kind === 'party') return id === 'coop' ? '多人合作' : '单人';
  if (kind === 'floor') return `${id}F`;
  if (kind === 'act') return `第 ${id} 阶段`;
  if (kind === 'playerPosition') return `玩家 ${id}`;
  if (kind === 'roomType') return zhMapType(id);
  return id;
}

export function dataItemPath(item: DataItemRef): string {
  const path = DATA_ITEM_META[item.kind].path;
  return path ? `/${path}/${encodeURIComponent(item.id)}` : '/dashboard';
}

export function dataSlicePath(items: DataItemRef[]): string {
  const params = new URLSearchParams();
  for (const item of items) params.append(item.kind, item.id);
  return `/slice?${params.toString()}`;
}

export function dataItemDestination(items: DataItemRef[]): string | null {
  if (!items.length) return null;
  return items.length === 1 ? dataItemPath(items[0]) : dataSlicePath(items);
}

export function itemKindForDimension(source: QueryDataSource, dimension: string): DataItemKind | null {
  if (dimension === 'entity') return source === 'cards' ? 'card' : source === 'relics' ? 'relic' : source === 'encounters' ? 'encounter' : null;
  return ({
    character: 'character', build: 'build', ascension: 'ascension', outcome: 'outcome', party: 'party', mode: 'gameMode',
    floor: 'floor', act: 'act', date: 'date', week: 'week', player_position: 'playerPosition', room_type: 'roomType'
  } as Record<string, DataItemKind>)[dimension] || null;
}

export function weekId(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date.getTime() - first.getTime()) / 86_400_000);
  return `${date.getUTCFullYear()}-W${String(Math.ceil((day + first.getUTCDay() + 1) / 7)).padStart(2, '0')}`;
}

const objectMatchCache = new Map<NormalizedRunV2, Set<string>>();
function recordedObjectKeys(run: NormalizedRunV2): Set<string> {
  const cached = objectMatchCache.get(run);
  if (cached) return cached;
  const keys = new Set(extractObjectObservations([run]).flatMap((event) => [event.object, ...event.related]).map((ref) => `${ref.kind}:${ref.id}`));
  objectMatchCache.set(run, keys);
  if (objectMatchCache.size > 128) objectMatchCache.delete(objectMatchCache.keys().next().value!);
  return keys;
}

export function runMatchesDataItem(run: NormalizedRunV2, item: DataItemRef): boolean {
  const { kind, id } = item;
  if (kind === 'run') return run.id === id;
  if (kind === 'character') return run.character === id || run.players.some((player) => player.character === id);
  if (kind === 'build') return (run.buildId || 'unknown') === id;
  if (kind === 'ascension') return run.ascension === Number(id);
  if (kind === 'outcome') return run.status === id;
  if (kind === 'party') return id === 'coop' ? run.isMultiplayer : !run.isMultiplayer;
  if (kind === 'gameMode') return (run.gameMode || 'standard').toLowerCase() === id.toLowerCase();
  if (kind === 'floor') return run.floor === Number(id) || run.timeline.some((point) => point.floor === Number(id));
  if (kind === 'act') return run.timeline.some((point) => point.act === Number(id));
  if (kind === 'date') return new Date(run.startTime * 1000).toISOString().slice(0, 10) === id;
  if (kind === 'week') return weekId(run.startTime) === id;
  if (kind === 'playerPosition') return run.players.length >= Number(id);
  if (kind === 'roomType') return run.timeline.some((point) => String(point.type || 'unknown').toLowerCase() === id.toLowerCase());
  return recordedObjectKeys(run).has(`${kind}:${id}`);
}

export function parseSliceItems(params: URLSearchParams): DataItemRef[] {
  const items: DataItemRef[] = [];
  for (const [kind, id] of params.entries()) {
    if (isDataItemKind(kind) && id) items.push({ kind, id });
  }
  return items;
}
