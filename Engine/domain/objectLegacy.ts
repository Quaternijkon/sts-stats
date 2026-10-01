import { UnifiedObjectRegistry } from './objectAnalysis.js';
import { zhCharacter, zhEntity } from './i18n.js';
import { wilsonInterval } from './quant.js';
import type { ObjectObservation } from './objectTypes.js';
import type { NormalizedRunV2 } from './types.js';
import { gameCharacters } from './game.js';

function unique(events: ObjectObservation[]): NormalizedRunV2[] { return [...new Map(events.map((event) => [event.run.id, event.run])).values()]; }
function completed(runs: NormalizedRunV2[]): NormalizedRunV2[] { return runs.filter((run) => run.status !== 'abandoned'); }
function rate(wins: number, total: number): number | null { return total ? wins / total : null; }
function winRate(runs: NormalizedRunV2[]): number | null { const rows = completed(runs); return rate(rows.filter((run) => run.win).length, rows.length); }
function mean(values: Array<number | undefined | null>): number | null {
  const rows = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}
function delta(a: number | null, b: number | null): number | null { return a === null || b === null ? null : a - b; }
function of(events: ObjectObservation[], event: string): ObjectObservation[] { return events.filter((row) => row.event === event); }
function characterPool(runs: NormalizedRunV2[], perspective?: string): NormalizedRunV2[] { const unique = [...new Map(runs.map((run) => [run.id, run])).values()]; return !perspective || ['all', 'overall'].includes(perspective) ? unique : unique.filter((run) => run.character === perspective); }

/** Compatibility DTOs are projections of the same evidence as objects/object. */
export function legacyEntityProfile(runs: NormalizedRunV2[], kind: 'card' | 'relic' | 'encounter', id: string, perspective?: string) {
  const pool = characterPool(runs, perspective);
  const registry = new UnifiedObjectRegistry(pool);
  const events = registry.model(kind, id)?.events || [];
  const slice = (scope: NormalizedRunV2[], rows: ObjectObservation[]) => {
    const related = unique(rows), picked = of(rows, 'picked'), offered = of(rows, 'offered'), held = of(rows, 'held');
    const acquired = of(rows, 'acquired');
    const pickedRuns = unique(picked), heldRuns = unique(held), offeredRuns = unique(offered);
    const pickedIds = new Set(pickedRuns.map((run) => run.id));
    const skippedRuns = offeredRuns.filter((run) => !pickedIds.has(run.id));
    const baseline = winRate(scope), relatedRate = winRate(related), pickedRate = winRate(pickedRuns), heldRate = winRate(heldRuns);
    const base = { runs: scope.length, offered: offered.length, picked: picked.length, pickRate: rate(picked.length, offered.length), relatedRunIds: related.map((run) => run.id) };
    if (kind === 'card') {
      const pickFloors = picked.map((row) => row.floor).filter((floor): floor is number => floor !== null);
      const holders = [...new Map(held.map((event) => [`${event.run.id}:${event.playerIndex}`, event])).values()];
      const upgradedCopies = holders.reduce((sum, event) => sum + (event.run.players[event.playerIndex]?.deck || []).filter((card) => card.id === id && card.upgradeLevel > 0).length, 0);
      return { ...base, seenRuns: offeredRuns.length, pickedRuns: pickedRuns.length, skippedRuns: skippedRuns.length,
        pickedCompletedRuns: completed(pickedRuns).length, skippedCompletedRuns: completed(skippedRuns).length,
        pickedWinRate: pickedRate, skippedWinRate: winRate(skippedRuns), pickDelta: delta(pickedRate, winRate(skippedRuns)),
        baselineWinRate: baseline, pickedVsBaseline: delta(pickedRate, baseline), avgPickFloor: mean(pickFloors), pickFloorSamples: pickFloors.length,
        finalDeckRuns: heldRuns.length, finalDeckCompletedRuns: completed(heldRuns).length, finalDeckShare: rate(heldRuns.length, scope.length),
        finalDeckWinRate: heldRate, finalDeckVsBaseline: delta(heldRate, baseline), avgFinalCopies: rate(held.length, heldRuns.length),
        upgradedShare: rate(upgradedCopies, held.length), avgFinalFloorWhenPicked: mean(pickedRuns.map((run) => run.floor)), pickFloors,
        acquired: acquired.length, removed: of(rows, 'removed').length, upgraded: of(rows, 'upgraded').length, downgraded: of(rows, 'downgraded').length };
    }
    if (kind === 'relic') {
      const acquisitionFloors = acquired.map((row) => row.floor).filter((floor): floor is number => floor !== null);
      return { ...base, relatedRuns: related.length, completedRelatedRuns: completed(related).length, possessionRate: rate(heldRuns.length, scope.length),
        winRate: relatedRate, baselineWinRate: baseline, delta: delta(relatedRate, baseline), avgAcquisitionFloor: mean(acquisitionFloors),
        acquisitionSamples: acquisitionFloors.length, acquisitionFloors, acquired: acquired.length, held: held.length, removed: of(rows, 'removed').length,
        avgFinalFloor: mean(related.map((run) => run.floor)), avgDamageTaken: mean(related.map((run) => run.totalDamageTaken)),
        avgFinalHpRatio: mean(related.filter((run) => run.maxHp > 0).map((run) => run.finalHp / run.maxHp)), avgDeckSize: mean(related.map((run) => run.deckSize)) };
    }
    const fights = of(rows, 'fought');
    const battleSlice = (values: ObjectObservation[]) => {
      const known = values.filter((row) => typeof row.telemetry?.killedPlayer === 'boolean');
      const deaths = known.filter((row) => row.telemetry?.killedPlayer).length;
      return { fights: values.length, avgDamage: mean(values.map((row) => row.telemetry?.damageTaken)), avgTurns: mean(values.map((row) => row.telemetry?.turns)), deaths: known.length ? deaths : null, survivalRate: rate(known.length - deaths, known.length) };
    };
    const damages = fights.map((row) => row.telemetry?.damageTaken).filter((value): value is number => value !== undefined);
    return { ...base, ...battleSlice(fights), relatedRuns: related.length, completedRelatedRuns: completed(related).length,
      totalDamage: damages.length ? damages.reduce((sum, value) => sum + value, 0) : null,
      avgFloor: mean(fights.map((row) => row.floor)), runWinRate: relatedRate, baselineWinRate: baseline, runWinDelta: delta(relatedRate, baseline),
      highDamageShare: rate(damages.filter((value) => value >= 20).length, damages.length),
      actRows: [...new Set(fights.map((row) => row.act).filter((act): act is number => act !== null))].sort((a, b) => a - b).map((act) => ({ act, ...battleSlice(fights.filter((row) => row.act === act)) })),
      damageValues: damages, floorValues: fights.map((row) => row.floor).filter((floor): floor is number => floor !== null) };
  };
  return { id, overall: slice(pool, events), byCharacter: gameCharacters().map((character) => ({ character, ...slice(pool.filter((run) => run.character === character), events.filter((event) => event.character === character)) })) };
}

export function legacyAncients(runs: NormalizedRunV2[]) {
  const registry = new UnifiedObjectRegistry(runs);
  const ids = [...new Set(registry.observations.filter((event) => event.object.kind === 'ancient').map((event) => event.object.id))];
  return ids.map((id) => {
    const model = registry.model('ancient', id)!;
    const visits = of(model.events, 'visited');
    const options = registry.observations.filter((event) => event.object.kind === 'relic' && event.event === 'offered' && event.related.some((ref) => ref.kind === 'ancient' && ref.id === id));
    return { id, label: zhEntity(id, 'ancients', id), visits: visits.length, nodeVisits: new Set(visits.map((event) => `${event.run.id}:${event.floor}`)).size, optionKinds: new Set(options.map((event) => event.object.id)).size, averageFloor: mean(visits.map((event) => event.floor)), winRate: winRate(model.relatedRuns) };
  }).sort((a, b) => b.visits - a.visits || a.id.localeCompare(b.id));
}

export function legacyAncient(runs: NormalizedRunV2[], id: string, perspective?: string) {
  const registry = new UnifiedObjectRegistry(characterPool(runs, perspective));
  const model = registry.model('ancient', id);
  if (!model) return {};
  const options = registry.observations.filter((event) => event.object.kind === 'relic' && ['offered', 'picked'].includes(event.event) && event.related.some((ref) => ref.kind === 'ancient' && ref.id === id));
  const baseline = winRate(model.relatedRuns);
  const rows = [...new Set(options.map((event) => event.object.id))].map((relicId) => {
    const events = options.filter((event) => event.object.id === relicId), offered = of(events, 'offered'), picked = of(events, 'picked');
    const selected = completed(unique(picked)), wins = selected.filter((run) => run.win).length, value = rate(wins, selected.length), interval = wilsonInterval(wins, selected.length);
    return { id: relicId, label: zhEntity(relicId, 'relics', relicId), offered: offered.length, picked: picked.length, pickRate: rate(picked.length, offered.length), completedPicked: selected.length, wins, winRate: value, baselineWinRate: baseline, delta: delta(value, baseline), ciLow: selected.length ? interval.low : null, ciHigh: selected.length ? interval.high : null, averageFloor: mean(offered.map((event) => event.floor)), relatedRunIds: unique(picked).map((run) => run.id) };
  }).sort((a, b) => b.offered - a.offered || b.picked - a.picked);
  return { options: rows, runs: model.relatedRuns.map((run) => ({ id: run.id, character: zhCharacter(run.character), floor: run.floor, status: run.status })), visits: of(model.events, 'visited').length, winRate: winRate(model.relatedRuns) };
}
