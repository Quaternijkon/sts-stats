// @ts-nocheck
const CHARACTER_ALIASES = new Map([
  ['IRONCLAD', 'Ironclad'], ['THE_IRONCLAD', 'Ironclad'], ['SILENT', 'Silent'], ['THE_SILENT', 'Silent'],
  ['REGENT', 'Regent'], ['NECROBINDER', 'Necrobinder'], ['DEFECT', 'Defect'], ['THE_DEFECT', 'Defect'],
  ['WATCHER', 'Watcher'], ['THE_WATCHER', 'Watcher']
]);

export const PARSER_VERSION = '2.3.0';

function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null); }
function numberValue(...values) { const n = Number(firstDefined(...values)); return Number.isFinite(n) ? n : 0; }

function optionalNumber(...values) {
  const value = firstDefined(...values);
  if (value === undefined || value === '' || typeof value === 'boolean') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function recordedNumbers(values) {
  return Object.keys(values).filter((key) => optionalNumber(...values[key]) !== undefined);
}

function normalizeCharacter(value) {
  if (!value) return 'Unknown';
  if (typeof value === 'object') value = firstDefined(value.id, value.character_id, value.character, value.name);
  const text = String(value);
  const key = text.split(/[.:/]/).pop().replace(/^CHARACTER_/, '').toUpperCase();
  if (CHARACTER_ALIASES.has(key)) return CHARACTER_ALIASES.get(key);
  const tail = text.replace(/^.*[.:/]/, '').replace(/^CHARACTER_/, '').replace(/_/g, ' ');
  const words = tail === tail.toUpperCase() ? tail.toLowerCase() : tail;
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeCardId(card) {
  if (!card) return null;
  if (typeof card === 'string') return card;
  return firstDefined(card.id, card.card_id, card.name, card.key, null);
}

function normalizeRelicId(relic) {
  if (!relic) return null;
  if (typeof relic === 'string') return relic;
  return firstDefined(relic.id, relic.relic_id, relic.choice, relic.name, relic.key, null);
}

export function normalizeCard(card) {
  if (!card) return null;
  if (typeof card === 'string') return { id: card, floorAdded: 0, floorKnown: false, upgradeLevel: 0, upgradeKnown: false };
  const id = normalizeCardId(card);
  if (!id) return null;
  const rawUpgradeLevel = firstDefined(card.current_upgrade_level, card.upgrade_level, card.upgrades);
  const upgradeLevel = typeof rawUpgradeLevel === 'number' || (typeof rawUpgradeLevel === 'string' && rawUpgradeLevel.trim() !== '') ? optionalNumber(rawUpgradeLevel) : undefined;
  return { id, floorAdded: numberValue(card.floor_added_to_deck, card.floor_added, card.floor), floorKnown: optionalNumber(card.floor_added_to_deck, card.floor_added, card.floor) !== undefined, upgradeLevel: upgradeLevel ?? 0, upgradeKnown: upgradeLevel !== undefined && Number.isInteger(upgradeLevel) && upgradeLevel >= 0 };
}

function normalizeRelic(relic) {
  if (!relic) return null;
  if (typeof relic === 'string') return { id: relic, floorAdded: 0, floorKnown: false };
  const id = normalizeRelicId(relic);
  if (!id) return null;
  return { id, floorAdded: numberValue(relic.floor_added_to_deck, relic.floor_added_to_inventory, relic.floor_added, relic.floor), floorKnown: optionalNumber(relic.floor_added_to_deck, relic.floor_added_to_inventory, relic.floor_added, relic.floor) !== undefined };
}

function normalizePlayer(player = {}, index = 0) {
  const deckRaw = firstDefined(player.deck, player.master_deck, player.cards, []) || [];
  const relicRaw = firstDefined(player.relics, []) || [];
  const potionRaw = firstDefined(player.potions, []) || [];
  return {
    id: numberValue(player.id, player.player_id, index + 1) || index + 1,
    character: normalizeCharacter(firstDefined(player.character, player.character_id, player.class)),
    deck: Array.isArray(deckRaw) ? deckRaw.map(normalizeCard).filter(Boolean) : [],
    relics: Array.isArray(relicRaw) ? relicRaw.map(normalizeRelic).filter(Boolean) : [],
    potions: normalizePotionList(potionRaw),
    badges: Array.isArray(player.badges) ? player.badges.map(String) : [],
    maxPotionSlots: numberValue(player.max_potion_slot_count)
  };
}

export function flattenMapHistory(history: any[] = []) {
  if (!Array.isArray(history)) return { acts: [], flat: [] };
  const nested = history.some(Array.isArray);
  const acts = nested ? history.map((act) => Array.isArray(act) ? act : [act]) : [history];
  let floor = 0;
  const flat = [];
  acts.forEach((act, actIndex) => act.forEach((point, actFloorIndex) => {
    if (!point || typeof point !== 'object') return;
    floor += 1;
    flat.push({ ...point, __floor: floor, __act: actIndex + 1, __actFloor: actFloorIndex + 1 });
  }));
  return { acts, flat };
}

function pointStats(point, playerIndex = 0, playerId = null) {
  const candidates = point?.player_stats;
  if (Array.isArray(candidates)) {
    if (playerId !== null && playerId !== undefined) {
      const exact = candidates.find((stats) => Number(stats?.player_id) === Number(playerId));
      if (exact) return exact;
    }
    return candidates[playerIndex] || candidates[0] || {};
  }
  return firstDefined(candidates, point?.stats, point?.player, {}) || {};
}

function getPointFloor(point, index) { return numberValue(point?.__floor, point?.floor, point?.floor_num, point?.floor_number, point?.map_point_index, index + 1); }
function getRoom(point) { return Array.isArray(point?.rooms) ? (point.rooms[0] || {}) : (firstDefined(point?.room, point?.combat, {}) || {}); }
function roomLabel(point) { const room = getRoom(point); return firstDefined(room?.model_id, point?.encounter_id, point?.encounter, room?.room_type, point?.map_point_type, 'Unknown'); }

function collectChoiceGroup(choices, floor, groups) {
  if (!Array.isArray(choices) || !choices.length) return;
  if (choices.some((choice) => choice?.card && 'was_picked' in choice)) {
    const offered = choices.map((choice) => normalizeCardId(choice.card)).filter(Boolean);
    const picked = normalizeCardId(choices.find((choice) => choice?.was_picked)?.card);
    groups.push({ floor, floorKnown: floor > 0, offered, picked });
    return;
  }
  for (const choice of choices) {
    const offeredRaw = firstDefined(choice?.cards_offered, choice?.not_picked, choice?.offered, choice?.cards, []) || [];
    const picked = normalizeCardId(firstDefined(choice?.card_picked, choice?.picked, choice?.chosen, null));
    const offered = [...new Set([...(Array.isArray(offeredRaw) ? offeredRaw.map(normalizeCardId).filter(Boolean) : []), picked].filter(Boolean))];
    if (offered.length || picked) groups.push({ floor: numberValue(choice?.floor, floor), floorKnown: optionalNumber(choice?.floor) !== undefined || floor > 0, offered, picked });
  }
}

export function collectCardChoices(raw, map = [], playerId = null, playerIndex = 0) {
  const groups = [];
  collectChoiceGroup(firstDefined(raw?.card_choices, raw?.card_rewards, []), 0, groups);
  map.forEach((point, index) => {
    const stats = pointStats(point, playerIndex, playerId);
    collectChoiceGroup(firstDefined(stats?.card_choices, point?.card_choices, point?.card_rewards, point?.rewards?.card_choices, []), getPointFloor(point, index), groups);
  });
  return groups;
}

export function collectEncounters(raw: any, map: any[] = [], playerId: any = null, playerIndex = 0) {
  const events = [];
  const killedBy = String(firstDefined(raw?.killed_by_encounter, '') || '');
  map.forEach((point, index) => {
    const room = getRoom(point);
    const type = String(firstDefined(point?.map_point_type, room?.room_type, '') || '').toLowerCase();
    if (!['monster', 'elite', 'boss'].includes(type)) return;
    const encounter = firstDefined(room?.model_id, point?.encounter_id, point?.encounter, point?.combat?.encounter_id, point?.combat?.id);
    if (!encounter) return;
    const stats = pointStats(point, playerIndex, playerId);
    const rawEncounter = String(encounter);
    const shortEncounter = rawEncounter.replace(/^ENCOUNTER[._]/i, '');
    const shortKilledBy = killedBy.replace(/^ENCOUNTER[._]/i, '');
    events.push({
      id: rawEncounter, type, act: numberValue(point?.__act, 1), floor: getPointFloor(point, index),
      damageTaken: numberValue(stats?.damage_taken, point?.damage_taken, point?.combat?.damage_taken),
      turns: numberValue(room?.turns_taken, stats?.turns, stats?.turns_taken, point?.turns, point?.combat?.turns),
      recordedFields: recordedNumbers({ damageTaken: [stats?.damage_taken, point?.damage_taken, point?.combat?.damage_taken], turns: [room?.turns_taken, stats?.turns, stats?.turns_taken, point?.turns, point?.combat?.turns] }),
      killedPlayer: index === map.length - 1 && numberValue(raw?.floor, raw?.floor_reached, raw?.floors_climbed, raw?.current_floor) <= getPointFloor(point, index) && !raw?.win && !raw?.victory && !raw?.was_abandoned && Boolean(killedBy) && (killedBy === rawEncounter || shortKilledBy === shortEncounter)
    });
  });
  return events;
}

export function collectRelics(raw, player = {}, map = [], playerId = null, playerIndex = 0) {
  const relics = new Set();
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else { const id = normalizeRelicId(value); if (id) relics.add(id); }
  };
  add(firstDefined(player?.relics, raw?.relics, []));
  for (const point of map) {
    const stats = pointStats(point, playerIndex, playerId);
    add(firstDefined(point?.relics_gained, point?.relics, point?.rewards?.relics, []));
    add(stats?.bought_relics);
    const choices = firstDefined(stats?.relic_choices, point?.relic_choice, point?.relic_choices);
    if (Array.isArray(choices)) choices.filter((entry) => entry?.was_picked || entry?.picked || entry?.chosen).forEach((entry) => add(firstDefined(entry?.choice, entry?.relic, entry?.relic_id, entry?.id)));
  }
  return [...relics];
}

function buildRestChoices(map, playerId, playerIndex) {
  const out = [];
  map.forEach((point, index) => {
    const stats = pointStats(point, playerIndex, playerId);
    for (const choice of stats?.rest_site_choices || []) out.push({ floor: getPointFloor(point, index), act: numberValue(point?.__act, 1), choice: String(choice) });
  });
  return out;
}

function buildDamageSources(map, playerId, playerIndex) {
  return map.map((point, index) => {
    const stats = pointStats(point, playerIndex, playerId);
    return { floor: getPointFloor(point, index), act: numberValue(point?.__act, 1), type: String(firstDefined(point?.map_point_type, getRoom(point)?.room_type, 'unknown')), damageTaken: numberValue(stats?.damage_taken) };
  }).filter((entry) => entry.damageTaken > 0);
}

function normalizeCardChoiceEntries(stats = {}) {
  const choices = stats?.card_choices;
  if (!Array.isArray(choices) || !choices.length) return [];
  if (choices.some((choice) => choice?.card && 'was_picked' in choice)) {
    return choices.map((choice) => ({
      id: normalizeCardId(choice?.card),
      picked: Boolean(choice?.was_picked),
      upgradeLevel: numberValue(choice?.card?.current_upgrade_level, choice?.card?.upgrade_level)
    })).filter((choice) => choice.id);
  }
  const groups = [];
  collectChoiceGroup(choices, 0, groups);
  return groups.flatMap((group) => group.offered.map((id) => ({ id, picked: id === group.picked, upgradeLevel: 0 })));
}

function normalizeRelicChoices(stats = {}) {
  const values = Array.isArray(stats?.relic_choices) ? stats.relic_choices : [];
  return values.map((entry) => ({
    id: normalizeRelicId(firstDefined(entry?.choice, entry?.relic, entry?.relic_id, entry?.id)),
    picked: Boolean(firstDefined(entry?.was_picked, entry?.picked, entry?.chosen, false))
  })).filter((entry) => entry.id);
}

function normalizeEventChoices(stats = {}) {
  const values = Array.isArray(stats?.event_choices) ? stats.event_choices : [];
  return values.map((entry) => ({
    id: String(firstDefined(entry?.id, entry?.choice, entry?.key, entry?.title?.key, entry?.title_key, '')),
    chosen: firstDefined(entry?.was_chosen, entry?.was_picked, entry?.chosen, entry?.picked) === undefined ? undefined : Boolean(firstDefined(entry?.was_chosen, entry?.was_picked, entry?.chosen, entry?.picked)),
    title: {
      table: String(firstDefined(entry?.title?.table, entry?.table, 'events')),
      key: String(firstDefined(entry?.title?.key, entry?.title_key, entry?.choice, entry?.key, entry?.id, ''))
    }
  }));
}

function normalizeAncientChoices(stats = {}) {
  const values = Array.isArray(stats?.ancient_choice) ? stats.ancient_choice : (Array.isArray(stats?.ancient_choices) ? stats.ancient_choices : []);
  return values.map((entry) => ({
    relicId: (() => {
      const key = String(firstDefined(entry?.TextKey, entry?.text_key, entry?.title?.key, entry?.title_key, '')).replace(/\.title$/i, '');
      return key ? (key.startsWith('RELIC.') ? key : `RELIC.${key}`) : '';
    })(),
    title: {
      table: String(firstDefined(entry?.title?.table, entry?.table, 'ancients')),
      key: String(firstDefined(entry?.title?.key, entry?.title_key, entry?.TextKey, entry?.text_key, ''))
    },
    chosen: Boolean(firstDefined(entry?.was_chosen, entry?.chosen, entry?.picked, false))
  }));
}

function normalizePotionList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === 'string' ? entry : firstDefined(entry?.id, entry?.potion_id, entry?.choice, entry?.name))
    .filter(Boolean)
    .map(String);
}

export function normalizeModifierIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    return [entry.id, entry.modifier_id, entry.model_id].find((id) => typeof id === 'string' && id.length > 0);
  }).filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && id !== '[object Object]');
}

function normalizePotionChoices(stats = {}) {
  const values = Array.isArray(stats?.potion_choices) ? stats.potion_choices : [];
  return values.map((entry) => ({
    id: String(firstDefined(entry?.choice, entry?.potion, entry?.potion_id, entry?.id, '')),
    picked: Boolean(firstDefined(entry?.was_picked, entry?.picked, entry?.chosen, false))
  })).filter((entry) => entry.id);
}

function normalizeEnchantedCards(stats = {}) {
  const values = Array.isArray(stats?.cards_enchanted) ? stats.cards_enchanted : [];
  return values.map((entry) => ({
    card: normalizeCard(entry?.card),
    enchantment: String(firstDefined(entry?.enchantment, entry?.card?.enchantment?.id, '')),
    amount: numberValue(entry?.card?.enchantment?.amount, entry?.amount)
  })).filter((entry) => entry.card?.id || entry.enchantment);
}

export function buildPlayerTimeline(run, playerIndex = 0) {
  const player = run?.players?.[playerIndex] || run?.players?.[0] || {};
  const playerId = player?.id;
  return (run?.map || []).map((point, index) => {
    const stats = pointStats(point, playerIndex, playerId);
    const room = getRoom(point);
    return {
      floor: getPointFloor(point, index), act: numberValue(point?.__act, 1), actFloor: numberValue(point?.__actFloor, index + 1),
      type: String(firstDefined(point?.map_point_type, room?.room_type, 'unknown')), label: roomLabel(point),
      ancientId: String(firstDefined(point?.map_point_type, room?.room_type, '')).toLowerCase() === 'ancient' ? String(roomLabel(point)) : null,
      recordedFields: recordedNumbers({ hp: [stats?.current_hp], maxHp: [stats?.max_hp], gold: [stats?.current_gold], damageTaken: [stats?.damage_taken], hpHealed: [stats?.hp_healed], goldGained: [stats?.gold_gained], goldSpent: [stats?.gold_spent], turns: [room?.turns_taken] }),
      hp: numberValue(stats?.current_hp), maxHp: numberValue(stats?.max_hp), gold: numberValue(stats?.current_gold),
      damageTaken: numberValue(stats?.damage_taken), hpHealed: numberValue(stats?.hp_healed), goldGained: numberValue(stats?.gold_gained), goldSpent: numberValue(stats?.gold_spent),
      goldLost: numberValue(stats?.gold_lost), goldStolen: numberValue(stats?.gold_stolen), stolenLoot: numberValue(stats?.stolen_loot),
      maxHpGained: numberValue(stats?.max_hp_gained), maxHpLost: numberValue(stats?.max_hp_lost), affectedByFurCoat: Boolean(stats?.is_affected_by_fur_coat),
      turns: numberValue(room?.turns_taken), cardsGained: (stats?.cards_gained || []).map(normalizeCard).filter(Boolean), cardsRemoved: (stats?.cards_removed || []).map(normalizeCard).filter(Boolean),
      cardsTransformed: (stats?.cards_transformed || []).map((entry) => ({ from: normalizeCard(entry?.original_card), to: normalizeCard(entry?.final_card) })).filter((entry) => entry.from || entry.to),
      upgradedCards: (stats?.upgraded_cards || []).map(normalizeCardId).filter(Boolean), downgradedCards: (stats?.downgraded_cards || []).map(normalizeCardId).filter(Boolean), enchantedCards: normalizeEnchantedCards(stats),
      cardChoices: normalizeCardChoiceEntries(stats), relicChoices: normalizeRelicChoices(stats), eventChoices: normalizeEventChoices(stats), ancientChoices: normalizeAncientChoices(stats),
      potionChoices: normalizePotionChoices(stats), potionsUsed: normalizePotionList(firstDefined(stats?.potion_used, stats?.potions_used, [])), potionsBought: normalizePotionList(stats?.bought_potions), potionsDiscarded: normalizePotionList(stats?.potion_discarded),
      boughtRelics: (stats?.bought_relics || []).map(normalizeRelicId).filter(Boolean), boughtColorless: (stats?.bought_colorless || []).map(normalizeCardId).filter(Boolean), relicsRemoved: (stats?.relics_removed || []).map(normalizeRelicId).filter(Boolean),
      relicsGained: (firstDefined(stats?.relics_gained, point?.relics_gained, point?.rewards?.relics, []) || []).map(normalizeRelicId).filter(Boolean),
      potionsGained: normalizePotionList(firstDefined(stats?.potions_gained, point?.potions_gained, point?.rewards?.potions, [])),
      completedQuestDetails: (stats?.completed_quests || []).map((entry) => typeof entry === 'string' ? { id: entry } : { id: String(firstDefined(entry?.quest_id, entry?.id, entry?.card_id, '')), cardId: normalizeCardId(firstDefined(entry?.card, entry?.card_id)) || undefined }).filter((entry) => entry.id),
      completedQuests: (stats?.completed_quests || []).map((entry) => typeof entry === 'string' ? entry : firstDefined(entry?.quest_id, entry?.id, entry?.card_id)).filter(Boolean).map(String),
      restChoices: [...(stats?.rest_site_choices || [])].map(String)
    };
  });
}

export function parseRunText(text, fileName = '', game = 'sts2'): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('游戏记录文件为空');
  let raw;
  try { raw = JSON.parse(trimmed); }
  catch (error) {
    const jsonStart = trimmed.indexOf('{'); const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) raw = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)); else throw error;
  }
  const detectedGame = game === 'sts1' || (raw?.play_id && raw?.character_chosen && Array.isArray(raw?.master_deck)) ? 'sts1' : 'sts2';
  return normalizeRun(raw, fileName, detectedGame);
}

export function parseProgressText(text) {
  const raw = JSON.parse(text.trim());
  const characterStats = (raw?.character_stats || []).filter((row) => !String(row?.id || row?.character || '').includes('RANDOM_CHARACTER')).map((row) => ({
    character: normalizeCharacter(row?.id || row?.character),
    wins: optionalNumber(row?.total_wins, row?.wins),
    losses: optionalNumber(row?.total_losses, row?.losses),
    playtime: optionalNumber(row?.playtime),
    fastestWinTime: optionalNumber(row?.fastest_win_time),
    bestWinStreak: optionalNumber(row?.best_win_streak),
    currentStreak: optionalNumber(row?.current_streak),
    maxAscension: optionalNumber(row?.max_ascension),
    preferredAscension: optionalNumber(row?.preferred_ascension),
    badges: Array.isArray(row?.badges) ? row.badges.map((badge) => ({ id: String(badge?.id || ''), rarity: String(badge?.rarity || ''), count: optionalNumber(badge?.count) })).filter((badge) => badge.id) : []
  }));
  const cardStats = (raw?.card_stats || []).map((row) => ({
    id: String(row?.id || ''),
    character: firstDefined(row?.character, row?.character_id) === undefined ? undefined : normalizeCharacter(firstDefined(row?.character, row?.character_id)),
    picked: optionalNumber(row?.times_picked), skipped: optionalNumber(row?.times_skipped),
    wins: optionalNumber(row?.times_won), losses: optionalNumber(row?.times_lost)
  })).filter((row) => row.id);
  const encounterStats = (raw?.encounter_stats || []).map((row) => ({
    id: String(row?.encounter_id || ''),
    characters: (row?.fight_stats || []).map((fight) => ({ character: normalizeCharacter(fight?.character), wins: optionalNumber(fight?.wins), losses: optionalNumber(fight?.losses) }))
  })).filter((row) => row.id);
  const ancientStats = (raw?.ancient_stats || []).map((row) => ({
    id: String(row?.ancient_id || ''),
    characters: (row?.character_stats || []).map((entry) => ({ character: normalizeCharacter(entry?.character), wins: optionalNumber(entry?.wins), losses: optionalNumber(entry?.losses) }))
  })).filter((row) => row.id);
  const enemyStats = (raw?.enemy_stats || []).map((row) => ({
    id: String(row?.enemy_id || ''),
    characters: (row?.fight_stats || []).map((fight) => ({ character: normalizeCharacter(fight?.character), wins: optionalNumber(fight?.wins), losses: optionalNumber(fight?.losses) }))
  })).filter((row) => row.id);
  const epochs = (raw?.epochs || []).map((row) => ({
    id: String(row?.id || ''), discovered: typeof row?.discovered === 'boolean' ? row.discovered : undefined, obtainDate: optionalNumber(row?.obtain_date), state: String(row?.state || '')
  })).filter((row) => row.id);
  const discoveries = Object.fromEntries(Object.entries(raw || {}).filter(([key, value]) => key.startsWith('discovered_') && Array.isArray(value)).map(([key, value]) => [key.slice(11), value.map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(Boolean).map(String)]));
  const markRecorded = (row) => ({ ...row, recordedFields: Object.keys(row).filter((key) => row[key] !== undefined) });
  const result = {
    characterStats: characterStats.map((row) => markRecorded({ ...row, badges: row.badges.map(markRecorded) })),
    cardStats: cardStats.map(markRecorded),
    encounterStats: encounterStats.map((row) => markRecorded({ ...row, characters: row.characters.map(markRecorded) })),
    ancientStats: ancientStats.map((row) => markRecorded({ ...row, characters: row.characters.map(markRecorded) })),
    enemyStats: enemyStats.map((row) => markRecorded({ ...row, characters: row.characters.map(markRecorded) })),
    epochs: epochs.map(markRecorded),
    discoveries,
    architectDamage: optionalNumber(raw?.architect_damage),
    currentScore: optionalNumber(raw?.current_score),
    floorsClimbed: optionalNumber(raw?.floors_climbed),
    totalPlaytime: optionalNumber(raw?.total_playtime),
    totalUnlocks: optionalNumber(raw?.total_unlocks),
    maxMultiplayerAscension: optionalNumber(raw?.max_multiplayer_ascension),
    preferredMultiplayerAscension: optionalNumber(raw?.preferred_multiplayer_ascension),
    testSubjectKills: optionalNumber(raw?.test_subject_kills),
    wongoPoints: optionalNumber(raw?.wongo_points),
    unlockedAchievements: Array.isArray(raw?.unlocked_achievements) ? raw.unlocked_achievements.map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(Boolean).map(String) : undefined,
    rawVersion: optionalNumber(raw?.schema_version)
  };
  return markRecorded(result);
}

function sts1Card(card) {
  if (typeof card !== 'string') return normalizeCard(card);
  const match = card.match(/^(.*)\+(\d+)$/);
  return { id: match ? match[1] : card, floorAdded: 0, floorKnown: false,
    upgradeLevel: match ? Number(match[2]) : 0, upgradeKnown: Boolean(match) };
}

function sts1NodeType(value) {
  return ({ M: 'monster', E: 'elite', B: 'boss', '?': 'event', '$': 'shop', R: 'rest', T: 'treasure' })[String(value || '').toUpperCase()] || 'unknown';
}

function sts1Act(floor) {
  if (floor <= 17) return 1;
  if (floor <= 34) return 2;
  if (floor <= 51) return 3;
  return 4;
}

function sts1ActFloor(floor) {
  return floor <= 17 ? floor : floor <= 34 ? floor - 17 : floor <= 51 ? floor - 34 : floor - 51;
}

function sts1FloorMap(values) {
  const map = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const floor = numberValue(value?.floor);
    if (!floor) continue;
    const items = map.get(floor) || [];
    items.push(value);
    map.set(floor, items);
  }
  return map;
}

function sts1GameMode(raw) {
  if (raw?.is_daily) return 'daily';
  if (raw?.is_trial || raw?.chose_seed || raw?.is_endless) return 'custom';
  return 'standard';
}

function normalizeSTS1Run(raw, fileName = '') {
  const character = normalizeCharacter(raw?.character_chosen);
  const deck = (Array.isArray(raw?.master_deck) ? raw.master_deck : []).map(sts1Card).filter(Boolean);
  const relics = (Array.isArray(raw?.relics) ? raw.relics : []).map(normalizeRelic).filter(Boolean);
  const potions = (Array.isArray(raw?.potions_obtained) ? raw.potions_obtained : []).map((entry) => entry?.key).filter(Boolean).map(String);
  const player = { id: 1, character, deck, relics, potions, badges: [], maxPotionSlots: 0 };
  const paths = Array.isArray(raw?.path_per_floor) ? raw.path_per_floor : [];
  const hp = Array.isArray(raw?.current_hp_per_floor) ? raw.current_hp_per_floor : [];
  const maxHp = Array.isArray(raw?.max_hp_per_floor) ? raw.max_hp_per_floor : [];
  const gold = Array.isArray(raw?.gold_per_floor) ? raw.gold_per_floor : [];
  const damage = sts1FloorMap(raw?.damage_taken);
  const camps = sts1FloorMap(raw?.campfire_choices);
  const choices = sts1FloorMap(raw?.card_choices);
  const events = sts1FloorMap(raw?.event_choices);
  const relicDrops = sts1FloorMap(raw?.relics_obtained);
  const potionDrops = sts1FloorMap(raw?.potions_obtained);
  const purges = new Map();
  (Array.isArray(raw?.items_purged) ? raw.items_purged : []).forEach((id, index) => {
    const floor = numberValue(raw?.items_purged_floors?.[index]);
    if (floor) purges.set(floor, [...(purges.get(floor) || []), id]);
  });
  const floorCount = Math.max(numberValue(raw?.floor_reached), paths.length, hp.length, maxHp.length, gold.length);
  const map = [];
  for (let floor = 1; floor <= floorCount; floor += 1) {
    const type = sts1NodeType(paths[floor - 1]);
    const fight = damage.get(floor)?.[0];
    const event = events.get(floor)?.[0];
    const campfire = camps.get(floor) || [];
    const stats = {
      current_hp: optionalNumber(hp[floor - 1]), max_hp: optionalNumber(maxHp[floor - 1]), current_gold: optionalNumber(gold[floor - 1]),
      damage_taken: optionalNumber(fight?.damage), hp_healed: optionalNumber(event?.damage_healed), gold_gained: optionalNumber(event?.gold_gain),
      gold_spent: optionalNumber(event?.gold_loss), turns: optionalNumber(fight?.turns),
      rest_site_choices: campfire.map((entry) => entry?.key).filter(Boolean),
      upgraded_cards: campfire.filter((entry) => String(entry?.key).toUpperCase() === 'SMITH').map((entry) => entry?.data).filter(Boolean),
      cards_removed: [...(purges.get(floor) || []), ...(events.get(floor) || []).flatMap((entry) => entry?.cards_removed || [])].map(sts1Card).filter(Boolean),
      card_choices: choices.get(floor) || [], relics_gained: (relicDrops.get(floor) || []).map((entry) => entry?.key).filter(Boolean),
      potions_gained: (potionDrops.get(floor) || []).map((entry) => entry?.key).filter(Boolean),
      event_choices: (events.get(floor) || []).map((entry) => ({ id: entry?.event_name, choice: entry?.player_choice,
        title: { table: 'events', key: entry?.event_name }, chosen: true }))
    };
    const bossChoice = floor % 17 === 0 ? raw?.boss_relics?.[Math.floor(floor / 17) - 1] : null;
    if (bossChoice) {
      stats.relic_choices = [...(bossChoice?.not_picked || []).map((id) => ({ id, picked: false })),
        ...(bossChoice?.picked ? [{ id: bossChoice.picked, picked: true }] : [])];
    }
    const label = fight?.enemies || event?.event_name || campfire[0]?.key || type;
    map.push({ __floor: floor, __act: sts1Act(floor), __actFloor: sts1ActFloor(floor), map_point_type: type,
      room: { model_id: String(label || 'Unknown'), room_type: type, turns_taken: optionalNumber(fight?.turns) }, player_stats: stats });
  }
  const status = raw?.victory ? 'win' : 'loss';
  const resolvedFileName = String(fileName || raw?.play_id || raw?.timestamp || Math.random().toString(36).slice(2));
  const encounterEvents = collectEncounters(raw, map, 1, 0);
  const cardChoices = collectCardChoices(raw, [], 1, 0);
  const run = {
    modelVersion: 2, parserVersion: PARSER_VERSION, gameVersion: 'sts1', sourceScope: 'history', sourceKey: resolvedFileName,
    importedAt: Date.now(), capabilities: { hasMap: map.length > 0, hasPlayerTelemetry: map.length > 0,
      hasCardChoices: cardChoices.length > 0, hasRelicEvents: relics.length > 0,
      hasEncounterEvents: encounterEvents.length > 0, hasVersion: Boolean(raw?.build_version) },
    id: resolvedFileName, fileName: resolvedFileName, raw, seed: String(raw?.seed_played ?? ''), buildId: String(raw?.build_version ?? ''),
    gameMode: sts1GameMode(raw), schemaVersion: 1, platformType: 'sts1', acts: [], modifiers: [], players: [player],
    playerCount: 1, isMultiplayer: false, character, ascension: numberValue(raw?.ascension_level), win: status === 'win', status,
    floor: floorCount, recordedNodeCount: map.length, runTime: numberValue(raw?.playtime), startTime: numberValue(raw?.timestamp),
    deckSize: deck.length, deck, relics, relicCount: relics.length, map, actCount: Math.max(0, ...map.map((point) => point.__act)),
    gold: numberValue(gold.at(-1), raw?.gold), finalHp: numberValue(hp.at(-1)), maxHp: numberValue(maxHp.at(-1)),
    killedBy: raw?.killed_by == null ? null : String(raw.killed_by), cardChoices, encounterEvents,
    relicEvents: [...new Set(relics.map((entry) => entry.id))], restChoices: buildRestChoices(map, 1, 0), damageSources: buildDamageSources(map, 1, 0)
  };
  run.playerTimelines = [buildPlayerTimeline(run, 0)];
  run.timeline = run.playerTimelines[0];
  run.totalDamageTaken = run.damageSources.reduce((sum, entry) => sum + entry.damageTaken, 0);
  run.eliteCount = encounterEvents.filter((entry) => entry.type === 'elite').length;
  run.combatCount = encounterEvents.length;
  run.upgradeCount = deck.filter((card) => card.upgradeLevel > 0).length;
  return run;
}

export function normalizeRun(raw, fileName = '', game = 'sts2'): any {
  if (game === 'sts1') return normalizeSTS1Run(raw, fileName);
  const rawPlayers = Array.isArray(raw?.players) ? raw.players : (raw?.player ? [raw.player] : []);
  const players = rawPlayers.map(normalizePlayer);
  if (!players.length) players.push(normalizePlayer({}, 0));
  const player = players[0];
  const rawPlayer = rawPlayers[0] || raw?.player || {};
  const history = flattenMapHistory(firstDefined(raw?.map_point_history, raw?.map_points, raw?.path, []) || []);
  const map = history.flat;
  const lastStats = pointStats(map.at(-1) || {}, 0, player.id);
  const status = raw?.was_abandoned ? 'abandoned' : (Boolean(firstDefined(raw?.win, raw?.victory, false)) ? 'win' : 'loss');
  const encounterEvents = collectEncounters(raw, map, player.id, 0);
  const resolvedFileName = String(fileName || firstDefined(raw?.id, raw?.run_id, raw?.start_time, raw?.seed, Math.random().toString(36).slice(2)));
  const run = {
    modelVersion: 2,
    parserVersion: PARSER_VERSION,
    gameVersion: 'sts2',
    sourceScope: 'history',
    sourceKey: resolvedFileName,
    importedAt: Date.now(),
    capabilities: {
      hasMap: map.length > 0,
      hasPlayerTelemetry: map.some((point) => Array.isArray(point?.player_stats) || point?.player_stats),
      hasCardChoices: collectCardChoices(raw, map, player.id, 0).length > 0,
      hasRelicEvents: collectRelics(raw, rawPlayer, map, player.id, 0).length > 0,
      hasEncounterEvents: encounterEvents.length > 0,
      hasVersion: Boolean(firstDefined(raw?.build_id, raw?.schema_version))
    },
    id: resolvedFileName, fileName: resolvedFileName, raw,
    seed: String(firstDefined(raw?.seed, '') || ''), buildId: String(firstDefined(raw?.build_id, '') || ''), gameMode: String(firstDefined(raw?.game_mode, '') || ''),
    schemaVersion: numberValue(raw?.schema_version), platformType: String(firstDefined(raw?.platform_type, '') || ''),
    acts: Array.isArray(raw?.acts) ? raw.acts.map(String) : [], modifiers: normalizeModifierIds(raw?.modifiers), players,
    playerCount: players.length, isMultiplayer: players.length > 1, character: player.character,
    ascension: numberValue(raw?.ascension, raw?.ascension_level, rawPlayer?.ascension), win: status === 'win', status,
    floor: Math.max(map.length, numberValue(raw?.floor, raw?.floor_reached, raw?.floors_climbed, raw?.current_floor)), recordedNodeCount: map.length, runTime: numberValue(raw?.run_time, raw?.play_time, raw?.playtime, raw?.duration), startTime: numberValue(raw?.start_time, raw?.timestamp, raw?.time, raw?.date),
    deckSize: player.deck.length, deck: player.deck, relics: player.relics, relicCount: player.relics.length, map, actCount: history.acts.length,
    gold: numberValue(lastStats?.current_gold, lastStats?.gold, rawPlayer?.gold, raw?.gold), finalHp: numberValue(lastStats?.current_hp, lastStats?.hp, rawPlayer?.current_hp, raw?.current_hp), maxHp: numberValue(lastStats?.max_hp, rawPlayer?.max_hp, raw?.max_hp),
    killedBy: firstDefined(raw?.killed_by_encounter, raw?.killed_by_event, raw?.killed_by) ?? null,
    cardChoices: collectCardChoices(raw, map, player.id, 0), encounterEvents,
    relicEvents: collectRelics(raw, rawPlayer, map, player.id, 0), restChoices: buildRestChoices(map, player.id, 0), damageSources: buildDamageSources(map, player.id, 0)
  };
  run.playerTimelines = players.map((_, index) => buildPlayerTimeline(run, index));
  run.timeline = run.playerTimelines[0] || [];
  run.totalDamageTaken = run.damageSources.reduce((sum, entry) => sum + entry.damageTaken, 0);
  run.eliteCount = encounterEvents.filter((entry) => entry.type === 'elite').length;
  run.combatCount = encounterEvents.length;
  run.upgradeCount = player.deck.filter((card) => card.upgradeLevel > 0).length;
  return run;
}

export function prettyId(value) {
  if (!value) return 'Unknown';
  const tail = String(value).split(/[.:/]/).pop();
  return tail.replace(/^(CARD|RELIC|ENCOUNTER)_/i, '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function readRunFiles(files, onProgress = () => {}) {
  const runFiles = [...files].filter((file) => file.name.toLowerCase().endsWith('.run'));
  const progressFile = [...files].find((file) => file.name.toLowerCase() === 'progress.save');
  const parsed = []; const failures = [];
  for (let index = 0; index < runFiles.length; index += 1) {
    const file = runFiles[index];
    try { parsed.push(parseRunText(await file.text(), file.name)); } catch (error) { failures.push({ file: file.name, error: error.message }); }
    onProgress(index + 1, runFiles.length);
  }
  let progress = null;
  if (progressFile) {
    try { progress = parseProgressText(await progressFile.text()); }
    catch (error) { failures.push({ file: progressFile.name, error: error.message }); }
  }
  return { runs: parsed, progress, failures, total: runFiles.length };
}

export async function collectDirectoryRunFiles(rootHandle) {
  const files = [];
  async function walk(directoryHandle) {
    for await (const entry of directoryHandle.values()) {
      if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.run') || entry.name.toLowerCase() === 'progress.save')) files.push(await entry.getFile());
      else if (entry.kind === 'directory') await walk(entry);
    }
  }
  await walk(rootHandle); return files;
}
