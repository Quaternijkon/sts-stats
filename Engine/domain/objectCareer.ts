import { officialZhTables, zhEntity, zhFromTable } from './i18n.js';
import type { ObjectCareerRecord, ObjectKind, ObjectMetric, ObjectMetricFormat, ObjectRef } from './objectTypes.js';
import type { CareerProgress } from './types.js';

type Row = Record<string, unknown>;
const discoveredCharacterIds: Record<string, string> = {
  'CHARACTER.IRONCLAD': 'Ironclad', 'CHARACTER.SILENT': 'Silent', 'CHARACTER.DEFECT': 'Defect',
  'CHARACTER.REGENT': 'Regent', 'CHARACTER.NECROBINDER': 'Necrobinder',
  'CHARACTER.DEPRIVED': 'Deprived', 'CHARACTER.RANDOM_CHARACTER': 'Random Character'
};
const categories: Partial<Record<ObjectKind, string>> = {
  card: 'cards', relic: 'relics', encounter: 'encounters', ancient: 'ancients', potion: 'potions',
  event: 'events', enemy: 'monsters', enchantment: 'enchantments', quest: 'quests',
  restChoice: 'rest_site_ui', badge: 'badges', epoch: 'epochs', achievement: 'achievements',
  location: 'acts', modifier: 'modifiers', character: 'characters'
};
const discoveryKinds: Record<string, ObjectKind> = {
  cards: 'card', relics: 'relic', encounters: 'encounter', ancients: 'ancient', potions: 'potion',
  events: 'event', monsters: 'enemy', enemies: 'enemy', enchantments: 'enchantment', quests: 'quest',
  badges: 'badge', epochs: 'epoch', achievements: 'achievement', acts: 'location', locations: 'location',
  modifiers: 'modifier', characters: 'character', rest_choices: 'restChoice', restChoices: 'restChoice'
};

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((entry): entry is Row => !!entry && typeof entry === 'object' && !Array.isArray(entry)) : [];
}
function string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function number(row: Row, key: string): number | null {
  if (Array.isArray(row.recordedFields) && !row.recordedFields.includes(key)) return null;
  return typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : null;
}
function ref(kind: ObjectKind, id: string): ObjectRef {
  const category = categories[kind];
  const label = kind === 'achievement' ? zhFromTable('achievements', `${id.replace(/^ACHIEVEMENT\./, '')}.title`, id) : zhEntity(id, category || null, id);
  return { kind, id, label };
}
function metric(row: Row, key: string, id: string, label: string, format: ObjectMetricFormat = 'number'): ObjectMetric | null {
  const value = number(row, key);
  return value === null ? null : { id, label, value, format };
}
function counters(row: Row, battle = false): ObjectMetric[] {
  const metrics = [
    metric(row, 'picked', 'careerPicked', '生涯选择'), metric(row, 'skipped', 'careerSkipped', '生涯跳过'),
    metric(row, 'wins', 'careerWins', battle ? '战斗胜利' : '生涯胜利'),
    metric(row, 'losses', 'careerLosses', battle ? '战斗失败' : '生涯失败'),
    metric(row, 'count', 'careerCount', '生涯次数')
  ].filter((entry): entry is ObjectMetric => entry !== null);
  const wins = number(row, 'wins');
  const losses = number(row, 'losses');
  if (wins !== null && losses !== null) metrics.push({
    id: 'careerWinRate', label: battle ? '战斗胜率' : '生涯胜率',
    value: wins + losses > 0 ? wins / (wins + losses) : null, format: 'percent'
  });
  return metrics;
}

/** Lifetime progress is independent of run history and never implies undiscovered objects. */
export function extractObjectCareer(progress: CareerProgress | null): ObjectCareerRecord[] {
  if (!progress) return [];
  const records: ObjectCareerRecord[] = [];
  const add = (kind: ObjectKind, id: string | null, character: string | null, source: 'career' | 'discovery', metrics: ObjectMetric[] = [], state: string | null = null, obtainedAt: number | null = null, discovered: boolean | null = null) => {
    if (!id) return;
    records.push({ id: JSON.stringify([source, kind, id, character, records.length]), object: ref(kind, id), character, source, metrics, state, obtainedAt, discovered });
  };
  for (const row of rows(progress.characterStats)) {
    const character = string(row.character);
    if (!character) continue;
    const metrics = counters(row);
    const fields: Array<[string, string, ObjectMetricFormat]> = [
      ['playtime', '游戏时长', 'duration'], ['fastestWinTime', '最快胜利用时', 'duration'],
      ['bestWinStreak', '最长连胜', 'number'], ['currentStreak', '当前连续战绩', 'number'],
      ['maxAscension', '最高进阶', 'number'], ['preferredAscension', '当前进阶', 'number']
    ];
    for (const [key, label, format] of fields) {
      const entry = metric(row, key, key, label, format);
      if (entry) metrics.push(entry);
    }
    add('character', character, character, 'career', metrics);
    for (const badge of rows(row.badges)) add('badge', string(badge.id), character, 'career', counters(badge), string(badge.rarity));
  }
  for (const row of rows(progress.cardStats)) add('card', string(row.id), string(row.character), 'career', counters(row));
  const fights: Array<[ObjectKind, unknown]> = [['encounter', progress.encounterStats], ['enemy', progress.enemyStats], ['ancient', progress.ancientStats]];
  for (const [kind, entries] of fights) {
    for (const row of rows(entries)) {
      const characters = rows(row.characters);
      if (characters.length) {
        for (const character of characters) add(kind, string(row.id), string(character.character), 'career', counters(character, kind !== 'ancient'));
      } else add(kind, string(row.id), string(row.character), 'career', counters(row, kind !== 'ancient'));
    }
  }
  for (const row of rows(progress.epochs)) {
    const obtainedAt = number(row, 'obtainDate');
    add('epoch', string(row.id), null, 'career', [], string(row.state), obtainedAt !== null && obtainedAt > 0 ? obtainedAt : null, typeof row.discovered === 'boolean' ? row.discovered : null);
  }

  const discoveries = new Set<string>();
  const ancientNames = officialZhTables().ancients || {};
  const addDiscovery = (kind: ObjectKind, id: string) => {
    if (kind === 'character') id = discoveredCharacterIds[id] || id;
    // EVENT is also the prefix of ordinary events; only known identities are ancient.
    if (kind === 'event' && Object.hasOwn(ancientNames, id)) kind = 'ancient';
    const key = JSON.stringify([kind, id]);
    if (discoveries.has(key)) return;
    discoveries.add(key);
    add(kind, id, null, 'discovery', [], null, null, true);
  };
  for (const [category, ids] of Object.entries(progress.discoveries || {})) {
    const kind = discoveryKinds[category];
    if (!kind || !Array.isArray(ids)) continue;
    for (const id of ids) if (string(id)) addDiscovery(kind, id);
  }
  if (Array.isArray(progress.unlockedAchievements)) {
    const unlocked = new Set<string>();
    for (const id of progress.unlockedAchievements) if (typeof id === 'string' && id && !unlocked.has(id)) {
      unlocked.add(id);
      add('achievement', id, null, 'career', [], 'unlocked', null, true);
    }
  }
  return records;
}
