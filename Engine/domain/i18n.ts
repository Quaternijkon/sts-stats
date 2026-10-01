// @ts-nocheck
import { OFFICIAL_ZH_GZIP_BASE64 } from '../official-zh.js';
import OFFICIAL_EXTRA from '../localization/official-extra.json';
import STS1_OFFICIAL from '../localization/sts1-official-zh.json';
import { gameVersion } from './game.js';

const binary = atob(OFFICIAL_ZH_GZIP_BASE64);
const compressed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
const OFFICIAL_ZH_TABLES = Object.freeze({ ...JSON.parse(await new Response(stream).text()), ...OFFICIAL_EXTRA.tables });
const STS1_ZH_TABLES = Object.freeze(STS1_OFFICIAL.tables);

const CHARACTER_IDS = Object.freeze({
  Ironclad: 'CHARACTER.IRONCLAD',
  Silent: 'CHARACTER.SILENT',
  Defect: 'CHARACTER.DEFECT',
  Regent: 'CHARACTER.REGENT',
  Necrobinder: 'CHARACTER.NECROBINDER',
  Watcher: 'Watcher',
  Deprived: 'CHARACTER.DEPRIVED',
  Random: 'CHARACTER.RANDOM_CHARACTER',
  Unknown: null
});

const PREFIX_TABLES = Object.freeze({
  CARD: 'cards',
  RELIC: 'relics',
  MONSTER: 'monsters',
  ENCOUNTER: 'encounters',
  POTION: 'potions',
  CHARACTER: 'characters',
  EVENT: 'events',
  ACT: 'acts',
  ENCHANTMENT: 'enchantments',
  BADGE: 'badges',
  MODIFIER: 'modifiers',
  ACHIEVEMENT: 'achievements'
});

const TABLE_PREFIXES = Object.freeze({
  cards: 'CARD',
  relics: 'RELIC',
  monsters: 'MONSTER',
  encounters: 'ENCOUNTER',
  potions: 'POTION',
  characters: 'CHARACTER',
  events: 'EVENT',
  acts: 'ACT',
  enchantments: 'ENCHANTMENT',
  badges: 'BADGE',
  modifiers: 'MODIFIER',
  achievements: 'ACHIEVEMENT'
});

// Legacy IDs observed in older local saves but no longer present as direct
// identity keys in the bundled v0.111.0 snapshot. Names follow the official
// base entity where available, otherwise the current Chinese community name.
const LEGACY_ZH_OVERRIDES = Object.freeze({
  'MONSTER.DECIMILLIPEDE_SEGMENT_FRONT': '残杀千足虫',
  'MONSTER.DECIMILLIPEDE_SEGMENT_MIDDLE': '残杀千足虫',
  'MONSTER.DECIMILLIPEDE_SEGMENT_BACK': '残杀千足虫',
  'CARD.FOLLOW_THROUGH': '跟进',
  'CARD.SCARE': '恫吓',
  'MODIFIER.CHARACTER_CARDS': '角色卡牌',
  'ENCOUNTER.BATTLEWORN_DUMMY_EVENT_ENCOUNTER': '历战假人',
  'ENCOUNTER.DOORMAKER_BOSS': '门扉缔造者',
  'MONSTER.DOORMAKER': '门扉缔造者'
});

const MODE_LABELS = Object.freeze({
  standard: '标准',
  daily: '每日挑战',
  custom: '自定义',
  unknown: '未知'
});

const STATUS_LABELS = Object.freeze({
  win: '胜利',
  loss: '失败',
  abandoned: '放弃'
});

const MOD_CHARACTER_LABELS = Object.freeze({ Watcher: '观者' });

const MAP_TYPE_LABELS = Object.freeze({
  monster: '敌人',
  enemy: '敌人',
  elite: '精英',
  boss: OFFICIAL_ZH_TABLES.map?.['LEGEND_BOSS.title'] || 'Boss',
  event: '事件',
  unknown: '未知',
  shop: '商人',
  merchant: '商人',
  rest: '休息',
  rest_site: '休息',
  treasure: '宝箱',
  ancient: '先古之民'
});

function humanize(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const tail = raw.includes('.') ? raw.split('.').at(-1) : raw;
  return tail.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function activeTables() { return gameVersion() === 'sts1' ? STS1_ZH_TABLES : OFFICIAL_ZH_TABLES; }

function sts1Table(category) {
  return ({ card: 'cards', cards: 'cards', relic: 'relics', relics: 'relics', encounter: 'monsters', encounters: 'monsters',
    enemy: 'monsters', enemies: 'monsters', potion: 'potions', potions: 'potions', event: 'events', events: 'events',
    modifier: 'modifiers', modifiers: 'modifiers', character: 'characters', characters: 'characters' })[String(category || '').toLowerCase()];
}

export function zhFromTable(table, key, fallback = '') {
  const normalizedTable = String(table || '').toLowerCase();
  const normalizedKey = String(key || '');
  if (gameVersion() === 'sts1') {
    const direct = STS1_ZH_TABLES[sts1Table(normalizedTable) || normalizedTable]?.[normalizedKey];
    return direct || fallback || humanize(normalizedKey);
  }
  const direct = OFFICIAL_ZH_TABLES[normalizedTable]?.[normalizedKey];
  if (direct) return direct;
  const simpleIdentity = normalizedKey.match(/^([A-Z0-9_]+)\.(?:title|name)$/);
  const prefix = TABLE_PREFIXES[normalizedTable];
  if (simpleIdentity && prefix) {
    const entityId = `${prefix}.${simpleIdentity[1]}`;
    if (LEGACY_ZH_OVERRIDES[entityId]) return LEGACY_ZH_OVERRIDES[entityId];
    if (OFFICIAL_ZH_TABLES[normalizedTable]?.[entityId]) return OFFICIAL_ZH_TABLES[normalizedTable][entityId];
  }
  return fallback || humanize(normalizedKey);
}

export function zhRef(ref, fallback = '') {
  if (!ref) return fallback;
  if (typeof ref === 'string') return zhEntity(ref, null, fallback);
  return zhFromTable(ref.table, ref.key, fallback || ref.key || '');
}

export function zhEntity(value: unknown, category: string | null = null, fallback = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (gameVersion() === 'sts1') {
    const table = sts1Table(category);
    const direct = table ? STS1_ZH_TABLES[table]?.[raw] : undefined;
    const character = STS1_ZH_TABLES.characters?.[raw];
    const inferred = STS1_ZH_TABLES.cards?.[raw] || STS1_ZH_TABLES.relics?.[raw] || STS1_ZH_TABLES.monsters?.[raw]
      || STS1_ZH_TABLES.events?.[raw] || STS1_ZH_TABLES.potions?.[raw] || STS1_ZH_TABLES.modifiers?.[raw];
    return direct || character || inferred || fallback || humanize(raw);
  }
  if (MOD_CHARACTER_LABELS[raw]) return MOD_CHARACTER_LABELS[raw];
  if (LEGACY_ZH_OVERRIDES[raw]) return LEGACY_ZH_OVERRIDES[raw];
  if (category && OFFICIAL_ZH_TABLES[category]?.[raw]) return OFFICIAL_ZH_TABLES[category][raw];
  if (CHARACTER_IDS[raw]) return OFFICIAL_ZH_TABLES.characters?.[CHARACTER_IDS[raw]] || fallback || raw;
  if (raw in CHARACTER_IDS && !CHARACTER_IDS[raw]) return '未知';
  const prefix = raw.includes('.') ? raw.split('.')[0] : '';
  const table = PREFIX_TABLES[prefix];
  if (table && OFFICIAL_ZH_TABLES[table]?.[raw]) return OFFICIAL_ZH_TABLES[table][raw];
  if (OFFICIAL_ZH_TABLES.epochs?.[raw]) return OFFICIAL_ZH_TABLES.epochs[raw];
  if (OFFICIAL_ZH_TABLES.rest_site_ui?.[raw]) return OFFICIAL_ZH_TABLES.rest_site_ui[raw];
  return fallback || humanize(raw);
}

export function zhCharacter(value) {
  return zhEntity(value, 'characters', value || '未知');
}

export function zhGameMode(value) {
  return MODE_LABELS[String(value || '').toLowerCase()] || zhFromTable('game_modes', String(value || ''), humanize(value));
}

export function zhStatus(value) {
  return STATUS_LABELS[String(value || '').toLowerCase()] || humanize(value);
}

export function zhMapType(value) {
  return MAP_TYPE_LABELS[String(value || '').toLowerCase()] || zhEntity(value, null, humanize(value));
}

export function zhReliability(value) {
  return ({ strong: '高', moderate: '中', limited: '低' })[String(value || '').toLowerCase()] || humanize(value);
}

export function officialZhTables() {
  return activeTables();
}
