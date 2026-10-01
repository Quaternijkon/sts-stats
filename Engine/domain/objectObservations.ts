import { buildPlayerTimeline, collectEncounters, flattenMapHistory, normalizeModifierIds } from './parser.js';
import { weekId } from './dataItems.js';
import type { NormalizedRunV2 } from './types.js';
import type { ObjectKind, ObjectObservation, ObjectRef } from './objectTypes.js';

type RecordValue = Record<string, any>;
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const identity = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const item = record(value);
  return String(item.id ?? item.card_id ?? item.relic_id ?? item.potion_id ?? item.enemy_id ?? item.quest_id ?? item.model_id ?? item.choice ?? '');
};
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const refs = (values: ObjectRef[]): ObjectRef[] => [...new Map(values.map((value) => [`${value.kind}:${value.id}`, value])).values()];

/** Extract only recorded solo evidence; every observation retains its original run. */
export function extractObjectObservations(runs: NormalizedRunV2[]): ObjectObservation[] {
  const result: ObjectObservation[] = [];
  const seenRuns = new Set<string>();
  for (const run of runs) {
    if (seenRuns.has(run.id) || run.isMultiplayer || run.playerCount > 1 || run.players?.length > 1) continue;
    seenRuns.add(run.id);
    const player = run.players?.[0];
    const character = player?.character || run.character;
    const raw = record(run.raw);
    const rawPlayer = record(list(raw.players)[0] ?? raw.player);
    const map = run.map?.length ? run.map : flattenMapHistory(raw.map_point_history ?? raw.map_points ?? raw.path ?? []).flat;
    const fresh = map.length ? buildPlayerTimeline({ ...run, map }, 0) : [];
    const normalized = run.playerTimelines?.[0]?.length ? run.playerTimelines[0] : run.timeline ?? [];
    const groups = new Map<string, { exemplar: ObjectObservation; sources: Map<string, ObjectObservation[]> }>();
    const facets: ObjectRef[] = [
      { kind: 'character', id: character }, { kind: 'ascension', id: String(run.ascension) },
      { kind: 'outcome', id: run.status }, { kind: 'party', id: 'solo' }, { kind: 'playerPosition', id: '1' }
    ];
    if (run.buildId) facets.push({ kind: 'build', id: run.buildId });
    if (run.gameMode) facets.push({ kind: 'gameMode', id: run.gameMode });
    if (run.startTime > 0 && Number.isFinite(new Date(run.startTime * 1000).getTime())) {
      facets.push({ kind: 'date', id: new Date(run.startTime * 1000).toISOString().slice(0, 10) }, { kind: 'week', id: weekId(run.startTime) });
    }
    const nodeRefs = new Map<number, ObjectRef[]>();
    const add = (kind: ObjectKind, value: unknown, event: string, source: string, floor: number | null = null, act: number | null = null, extra: Partial<ObjectObservation> = {}) => {
      const id = identity(value);
      if (!id) return;
      const observation: ObjectObservation = { object: { kind, id }, run, playerIndex: 0, character, floor, act, event, sources: [source], related: [], ...extra };
      const key = JSON.stringify([floor, kind, id, event]);
      let group = groups.get(key);
      if (!group) { group = { exemplar: observation, sources: new Map() }; groups.set(key, group); }
      const entries = group.sources.get(source) ?? [];
      entries.push(observation);
      group.sources.set(source, entries);
      if (floor !== null) nodeRefs.set(floor, refs([...(nodeRefs.get(floor) ?? []), observation.object, ...observation.related]));
    };
    for (const facet of facets) add(facet.kind, facet.id, 'recorded', 'run');
    const lastRecordedFloor = Math.max(-1, ...[...fresh, ...normalized].map((point) => finite(point.floor) ?? -1));
    const terminalFloor = Math.max(finite(run.floor) ?? -1, lastRecordedFloor);
    const battleOutcome = (id: string, floor: number | null, hp?: number, recordedDeath?: boolean): boolean | undefined => {
      const killer = String(run.killedBy ?? '');
      const sameKiller = Boolean(killer) && killer.replace(/^ENCOUNTER[._]/i, '') === id.replace(/^ENCOUNTER[._]/i, '');
      if (run.status === 'loss' && floor === terminalFloor && (sameKiller || recordedDeath === true)) return true;
      if (run.status === 'win' || (floor !== null && floor < lastRecordedFloor) || (hp !== undefined && hp > 0)) return false;
      if (run.status === 'loss' && floor === terminalFloor && (raw.killed_by_event || /^EVENT[._]/i.test(killer))) return false;
      return undefined;
    };
    const acts = list(raw.acts).length ? list(raw.acts) : list(run.acts);
    const telemetry = (point: RecordValue): ObjectObservation['telemetry'] => {
      const fields = new Set(list(point.recordedFields));
      const out: NonNullable<ObjectObservation['telemetry']> = {};
      for (const key of ['damageTaken', 'turns', 'hp', 'maxHp', 'gold', 'hpHealed', 'goldGained', 'goldSpent'] as const) {
        if (fields.has(key) && finite(point[key]) !== null) out[key] = point[key];
      }
      return Object.keys(out).length ? out : undefined;
    };
    const processPoint = (point: RecordValue, source: string) => {
      const floor = finite(point.floor);
      const act = finite(point.act);
      const type = String(point.type ?? '').toLowerCase();
      const base = { telemetry: telemetry(point) };
      const emit = (kind: ObjectKind, id: unknown, event: string, field: string, extra: Partial<ObjectObservation> = {}) => add(kind, id, event, `${source}.${field}`, floor, act, extra);
      if (floor !== null) emit('floor', floor, 'recorded', 'floor', base);
      if (act !== null) emit('act', act, 'visited', 'act', base);
      if (type && type !== 'unknown') emit('roomType', type, 'visited', 'type', base);
      if (act !== null && identity(acts[act - 1])) emit('location', acts[act - 1], 'visited', 'acts', base);
      const ancient = identity(point.ancientId) || (type === 'ancient' ? identity(point.label) : '');
      const eventId = identity(point.eventId) || (type === 'event' ? identity(point.label) : '');
      const encounter = identity(point.encounterId) || (['monster', 'elite', 'boss', 'combat'].includes(type) ? identity(point.label) : '');
      if (ancient && ancient !== 'Unknown') emit('ancient', ancient, 'visited', 'ancient', base);
      if (eventId && eventId !== 'Unknown') emit('event', eventId, 'visited', 'event', base);
      if (encounter && encounter !== 'Unknown') {
        const killedPlayer = battleOutcome(encounter, floor, base.telemetry?.hp);
        emit('encounter', encounter, 'fought', 'encounter', { telemetry: { ...base.telemetry, ...(killedPlayer !== undefined ? { killedPlayer } : {}) } });
      }
      const choices = (kind: ObjectKind, values: unknown, field: string, related: ObjectRef[] = []) => {
        for (const choice of list(values)) {
          const id = identity(choice.relicId ?? choice.id ?? choice.card ?? choice.relic ?? choice.potion ?? choice.choice);
          const picked = choice.picked ?? choice.chosen ?? choice.was_picked ?? choice.was_chosen;
          emit(kind, id, 'offered', field, { related });
          emit(kind, id, picked ? 'picked' : 'skipped', field, { related });
          if (picked) emit(kind, id, 'acquired', field, { related });
        }
      };
      choices('card', point.cardChoices, 'cardChoices');
      choices('relic', point.relicChoices, 'relicChoices', ancient ? [{ kind: 'ancient', id: ancient }] : []);
      choices('relic', point.ancientChoices, 'ancientChoices', ancient ? [{ kind: 'ancient', id: ancient }] : []);
      if (ancient) for (const choice of list(point.ancientChoices)) {
        if (choice.chosen ?? choice.picked ?? choice.was_chosen ?? choice.was_picked) {
          const id = identity(choice.relicId ?? choice.relic ?? choice.id);
          emit('ancient', ancient, 'selected', 'ancientChoices', { choiceId: id || undefined, related: id ? [{ kind: 'relic', id }] : [] });
        }
      }
      choices('potion', point.potionChoices, 'potionChoices');
      for (const [field, kind, behavior] of [
        ['cardsGained', 'card', 'acquired'], ['cardsRemoved', 'card', 'removed'], ['upgradedCards', 'card', 'upgraded'], ['downgradedCards', 'card', 'downgraded'],
        ['boughtColorless', 'card', 'bought'], ['boughtCards', 'card', 'bought'], ['relicsGained', 'relic', 'acquired'], ['boughtRelics', 'relic', 'bought'], ['relicsRemoved', 'relic', 'removed'],
        ['potionsUsed', 'potion', 'used'], ['potionsBought', 'potion', 'bought'], ['potionsDiscarded', 'potion', 'discarded'], ['potionsGained', 'potion', 'acquired'],
        ['restChoices', 'restChoice', 'selected'], ['enemies', 'enemy', 'fought'], ['enemyIds', 'enemy', 'fought']
      ] as [string, ObjectKind, string][]) {
        for (const value of list(point[field])) {
          emit(kind, value, behavior, field, kind === 'restChoice' ? base : {});
          if (behavior === 'bought') emit(kind, value, 'acquired', field);
        }
      }
      for (const transform of list(point.cardsTransformed)) {
        const from = identity(transform.from ?? transform.original_card), to = identity(transform.to ?? transform.final_card);
        emit('card', from, 'transformedFrom', 'cardsTransformed', { related: to ? [{ kind: 'card', id: to }] : [] });
        emit('card', to, 'transformedTo', 'cardsTransformed', { related: from ? [{ kind: 'card', id: from }] : [] });
        emit('card', to, 'acquired', 'cardsTransformed');
      }
      for (const enchant of list(point.enchantedCards)) {
        const card = identity(enchant.card), enchantment = identity(enchant.enchantment);
        emit('card', card, 'enchanted', 'enchantedCards', { related: enchantment ? [{ kind: 'enchantment', id: enchantment }] : [] });
        emit('enchantment', enchantment, 'applied', 'enchantedCards', { related: card ? [{ kind: 'card', id: card }] : [], ...(finite(enchant.amount) !== null ? { amount: enchant.amount } : {}) });
      }
      for (const [field, values] of [['completedQuests', point.completedQuests], ['completedQuestDetails', point.completedQuestDetails]] as [string, unknown][]) for (const quest of list(values)) {
        const id = identity(quest), card = identity(record(quest).card ?? record(quest).cardId ?? record(quest).card_id) || (/^CARD[._]/i.test(id) ? id : '');
        emit('quest', id, 'completed', field, { related: card ? [{ kind: 'card', id: card }] : [] });
        if (card) emit('card', card, 'completed', field, { related: id ? [{ kind: 'quest', id }] : [] });
      }
      for (const choice of list(point.eventChoices)) {
        if (choice.chosen === false || choice.picked === false || choice.was_chosen === false || choice.was_picked === false) continue;
        const key = String(choice.title?.key ?? choice.choiceId ?? choice.key ?? choice.id ?? '');
        if (eventId && key) emit('event', eventId, 'selected', 'eventChoices', { choiceId: key, choiceLabel: String(choice.label ?? choice.title?.label ?? key) });
      }
    };
    for (const [index, point] of fresh.entries()) {
      const rawPoint = record(map[index]);
      const room = record(list(rawPoint.rooms)[0] ?? rawPoint.room ?? rawPoint.combat);
      processPoint({ ...point, enemies: list(point.enemies).length ? point.enemies : room.enemies ?? rawPoint.enemies, enemyIds: list(point.enemyIds).length ? point.enemyIds : room.enemy_ids ?? rawPoint.enemy_ids }, 'map');
    }
    for (const point of normalized) processPoint(point, 'timeline');
    for (const choice of run.cardChoices ?? []) {
      const floor = choice.floorKnown === false || (choice.floorKnown === undefined && choice.floor === 0) ? null : finite(choice.floor);
      const act = finite([...fresh, ...normalized].find((point) => point.floor === floor)?.act);
      const offered = [...choice.offered];
      if (choice.picked && !offered.includes(choice.picked)) offered.push(choice.picked);
      for (const id of offered) {
        add('card', id, 'offered', 'cardChoices', floor, act);
        add('card', id, id === choice.picked ? 'picked' : 'skipped', 'cardChoices', floor, act);
      }
      if (choice.picked) add('card', choice.picked, 'acquired', 'cardChoices', floor, act);
    }
    for (const choice of list(run.restChoices)) add('restChoice', choice.choice ?? choice.id, 'selected', 'restChoices', finite(choice.floor), finite(choice.act));
    const freshEncounters = map.length ? collectEncounters(raw, map, player?.id ?? null, 0) : [];
    for (const [source, encounters] of [['map.encounterEvents', freshEncounters], ['encounterEvents', run.encounterEvents ?? []]] as [string, RecordValue[]][]) for (const encounter of encounters) {
      const floor = finite(encounter.floor), fields = new Set(list(encounter.recordedFields));
      const info: NonNullable<ObjectObservation['telemetry']> = {};
      if (fields.has('damageTaken') && finite(encounter.damageTaken) !== null) info.damageTaken = encounter.damageTaken as number;
      if (fields.has('turns') && finite(encounter.turns) !== null) info.turns = encounter.turns as number;
      const killedPlayer = battleOutcome(encounter.id, floor, undefined, encounter.killedPlayer === true);
      if (killedPlayer !== undefined) info.killedPlayer = killedPlayer;
      add('encounter', encounter.id, 'fought', source, floor, finite(encounter.act), { telemetry: info });
    }
    for (const [kind, values, rawValues] of [
      ['card', player?.deck ?? run.deck, rawPlayer.deck ?? rawPlayer.master_deck ?? rawPlayer.cards],
      ['relic', player?.relics ?? run.relics, rawPlayer.relics]
    ] as [ObjectKind, unknown, unknown][]) {
      for (const [index, value] of list(values).entries()) {
        add(kind, value, 'held', `final.${kind}`);
        const item = record(value), original = record(list(rawValues)[index]);
        const explicit = original.floor_added_to_deck ?? original.floor_added_to_inventory ?? original.floor_added ?? original.floor;
        const known = item.floorAddedKnown ?? item.floorKnown ?? (explicit !== undefined || (finite(item.floorAdded) ?? 0) > 0);
        const floor = finite(item.floorAdded) ?? finite(explicit);
        if (known && floor !== null) add(kind, value, 'acquired', `final.${kind}.floorAdded`, floor, finite([...fresh, ...normalized].find((point) => point.floor === floor)?.act));
      }
    }
    for (const potion of player?.potions ?? []) add('potion', potion, 'held', 'final.potions');
    for (const badge of player?.badges ?? []) add('badge', badge, 'held', 'final.badges');
    for (const relicId of run.relicEvents || []) {
      const represented = [...groups.values()].some((group) => group.exemplar.object.kind === 'relic' && group.exemplar.object.id === relicId);
      if (!represented) add('relic', relicId, 'recorded', 'relicEvents');
    }
    const savedModifiers = list(run.modifiers);
    // Older dataset.json files stringified modifier objects. Recover their IDs
    // from the retained raw record without rewriting the dataset or game saves.
    const modifierSource = Array.isArray(raw.modifiers) && (!savedModifiers.length || savedModifiers.includes('[object Object]'))
      ? raw.modifiers : savedModifiers;
    for (const modifier of normalizeModifierIds(modifierSource)) add('modifier', modifier, 'applied', 'run.modifiers');
    if (finite(run.floor) !== null && (run.floorKnown !== false) && (run.floor > 0 || run.floorKnown === true)) add('floor', run.floor, 'reached', 'run.floor');
    const runObjects = refs([...groups.values()].map((group) => group.exemplar.object));
    const facetKinds = new Set(facets.map((facet) => facet.kind));
    const nodeContextKinds = new Set<ObjectKind>(['floor', 'act', 'roomType', 'location', 'encounter', 'event', 'ancient']);
    for (const group of groups.values()) {
      const batches = [...group.sources.values()];
      const count = Math.max(...batches.map((entries) => entries.length));
      for (let index = 0; index < count; index += 1) {
        const overlaps = batches.flatMap((entries) => entries[index] ? [entries[index]] : []);
        const observation = { ...group.exemplar, ...overlaps[0] };
        observation.sources = [...group.sources].filter(([, entries]) => index < entries.length).map(([source]) => source);
        observation.telemetry = Object.assign({}, ...overlaps.map((entry) => entry.telemetry));
        // Inventory objects share node context, not causal links to every other item on that floor.
        // Explicit transformation, enchantment, quest and ancient-choice references remain intact.
        const context = observation.floor !== null ? (nodeRefs.get(observation.floor) ?? []).filter((ref) => nodeContextKinds.has(observation.object.kind) || nodeContextKinds.has(ref.kind)) : facetKinds.has(observation.object.kind) ? runObjects : [];
        observation.related = refs([...facets, ...context, ...overlaps.flatMap((entry) => entry.related)]).filter((ref) => ref.kind !== observation.object.kind || ref.id !== observation.object.id);
        result.push(observation);
      }
    }
  }
  return result;
}
