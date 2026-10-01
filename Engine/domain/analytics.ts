// @ts-nocheck
import { prettyId } from './parser.js';
import { sampleReliability, wilsonInterval } from './quant.js';
import { zhEntity, zhMapType, zhRef } from './i18n.js';
import { gameCharacters } from './game.js';

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

export function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(digits).replace(/\.0$/, '')}%`;
}

export function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  if (value <= 0) return '—';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function formatDate(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return '日期未知';
  const ms = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.valueOf())) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function summarizeRuns(runs) {
  const total = runs.length;
  const wins = runs.filter((run) => run.win).length;
  const completed = runs.filter((run) => run.status !== 'abandoned');
  const avgFloor = average(completed.map((run) => run.floor));
  const avgTime = average(completed.map((run) => run.runTime));
  const avgDeck = average(completed.map((run) => run.deckSize));
  const highestAscension = Math.max(0, ...runs.map((run) => Number(run.ascension) || 0));
  const currentStreak = getCurrentStreak(runs);

  return {
    total,
    completed: completed.length,
    wins,
    losses: runs.filter((run) => !run.win && run.status !== 'abandoned').length,
    abandoned: runs.filter((run) => run.status === 'abandoned').length,
    winRate: ratio(wins, completed.length),
    avgFloor,
    avgTime,
    avgDeck,
    highestAscension,
    currentStreak,
    maxWinStreak: getMaxWinStreak(runs),
    avgDamageTaken: ratio(runs.reduce((sum, run) => sum + (Number(run.totalDamageTaken) || 0), 0), total),
    minWinningDeckSize: wins ? Math.min(...runs.filter((run) => run.win).map((run) => run.deckSize)) : null,
    maxWinningDeckSize: wins ? Math.max(...runs.filter((run) => run.win).map((run) => run.deckSize)) : null
  };
}

export function average(values) {
  const clean = values.map(Number).filter(Number.isFinite).filter((value) => value !== 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function detailCharacters() { return gameCharacters(); }

export function dashboardHistory(runs) {
  const limit = 100;
  const createGroup = (id) => ({ id, total: 0, wins: 0, losses: 0, abandoned: 0, items: [] });
  const overall = createGroup('all');
  const groups = new Map(detailCharacters().map((id) => [id, createGroup(id)]));
  const sorted = [...runs].sort((a, b) => {
    const first = Number.isFinite(a.startTime) ? a.startTime : 0;
    const second = Number.isFinite(b.startTime) ? b.startTime : 0;
    return first - second || String(a.id).localeCompare(String(b.id));
  });
  for (const run of sorted) {
    const character = detailCharacters().includes(run.character) ? run.character : 'Unknown';
    if (!groups.has(character)) groups.set(character, createGroup(character));
    const entry = {
      id: run.id,
      character,
      status: run.status,
      startTime: run.startTime,
      runTime: run.runTime,
      ascension: run.ascension
    };
    for (const group of [overall, groups.get(character)]) {
      group.total += 1;
      if (run.status === 'abandoned') group.abandoned += 1;
      else if (run.status === 'win') group.wins += 1;
      else group.losses += 1;
      group.items.push(entry);
      // Every history group scrolls horizontally; keep all filtered records.
    }
  }
  return { overall, characters: [...groups.values()], limit };
}

function validActivityDays(value) {
  if (!Array.isArray(value) || value.length > 370) return [];
  let previousEnd = -Infinity;
  let previousDate = '';
  for (const day of value) {
    if (!day || typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return [];
    const date = new Date(`${day.date}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== day.date) return [];
    if (!Number.isFinite(day.startTime) || !Number.isFinite(day.endTime)
      || !Number.isFinite(new Date(day.startTime * 1000).valueOf())
      || !Number.isFinite(new Date(day.endTime * 1000).valueOf())
      || day.endTime <= day.startTime || day.startTime < previousEnd || day.date <= previousDate) return [];
    previousEnd = day.endTime;
    previousDate = day.date;
  }
  return value;
}

export function dashboardPlaytime(runs, activityDays) {
  const boundaries = validActivityDays(activityDays);
  const days = boundaries.map(({ date }) => ({ date, seconds: 0, runCount: 0, percentile: null, level: 0 }));
  let totalSeconds = 0;
  let totalRuns = 0;
  let firstStartTime = null;
  let lastStartTime = null;
  for (const run of runs) {
    const start = run.startTime;
    const end = start + run.runTime;
    if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(run.runTime) || run.runTime <= 0
      || !Number.isFinite(end) || end <= start
      || !Number.isFinite(new Date(start * 1000).valueOf())
      || !Number.isFinite(new Date(end * 1000).valueOf())) continue;
    firstStartTime = firstStartTime === null ? start : Math.min(firstStartTime, start);
    lastStartTime = lastStartTime === null ? start : Math.max(lastStartTime, start);

    // Locate the first possibly overlapping local day; gaps and DST need no special cases.
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (boundaries[middle].endTime <= start) low = middle + 1;
      else high = middle;
    }
    let included = false;
    for (let index = low; index < boundaries.length && boundaries[index].startTime < end; index += 1) {
      const seconds = Math.min(end, boundaries[index].endTime) - Math.max(start, boundaries[index].startTime);
      if (seconds <= 0) continue;
      days[index].seconds += seconds;
      days[index].runCount += 1;
      totalSeconds += seconds;
      included = true;
    }
    if (included) totalRuns += 1;
  }
  const active = days.filter((day) => day.seconds > 0).sort((a, b) => a.seconds - b.seconds);
  for (let first = 0; first < active.length;) {
    let end = first + 1;
    while (end < active.length && active[end].seconds === active[first].seconds) end += 1;
    const percentile = active.length === 1 ? 1 : ((first + end - 1) / 2) / (active.length - 1);
    for (let index = first; index < end; index += 1) {
      active[index].percentile = percentile;
      active[index].level = Math.min(4, Math.max(1, Math.ceil(percentile * 4)));
    }
    first = end;
  }
  return { days, totalSeconds, activeDays: active.length, totalRuns, firstStartTime, lastStartTime };
}

function completedRuns(runs) {
  return runs.filter((run) => run.status !== 'abandoned');
}

function completedWinRate(runs) {
  const completed = completedRuns(runs);
  return ratio(completed.filter((run) => run.win).length, completed.length);
}

function itemCharacterRows(runs, sliceFn) {
  return detailCharacters().map((character) => ({
    character,
    ...sliceFn(runs.filter((run) => run.character === character))
  }));
}

function matchingDeckCards(run, id) {
  return (run.deck || []).filter((card) => String(card?.id || card) === String(id));
}

function matchingRelics(run, id) {
  const normalized = String(id);
  const final = (run.relics || []).filter((relic) => String(relic?.id || relic) === normalized);
  const hasEvent = (run.relicEvents || []).some((relicId) => String(relicId) === normalized);
  return { final, has: final.length > 0 || hasEvent };
}

function atomicCardChoices(run) {
  const timelineChoices = (run.timeline || []).flatMap((point) => (point.cardChoices || []).flatMap((choice) => {
    const id = String(choice?.id || '');
    return id ? [{ floor: Number(point.floor) || 0, offered: [id], picked: choice?.picked ? id : null }] : [];
  }));
  return timelineChoices.length ? timelineChoices : (run.cardChoices || []);
}

function cardDetailSlice(runs, id) {
  const normalized = String(id);
  let offered = 0;
  let picked = 0;
  const seenRuns = new Set();
  const pickedRuns = new Set();
  const skippedRuns = new Set();
  const pickFloors = [];
  const pickedRunObjects = [];
  const skippedRunObjects = [];
  const finalDeckRuns = [];
  let finalCopies = 0;
  let upgradedCopies = 0;

  for (const run of runs) {
    let seenInRun = false;
    let pickedInRun = false;
    for (const choice of atomicCardChoices(run)) {
      if ((choice.offered || []).some((cardId) => String(cardId) === normalized)) {
        offered += 1;
        seenInRun = true;
      }
      if (String(choice.picked || '') === normalized) {
        picked += 1;
        seenInRun = true;
        pickedInRun = true;
        const floor = Number(choice.floor) || 0;
        if (floor > 0) pickFloors.push(floor);
      }
    }
    if (seenInRun) seenRuns.add(String(run.id));
    if (pickedInRun) {
      pickedRuns.add(String(run.id));
      pickedRunObjects.push(run);
    } else if (seenInRun) {
      skippedRuns.add(String(run.id));
      skippedRunObjects.push(run);
    }
    const finalCards = matchingDeckCards(run, normalized);
    if (finalCards.length) {
      finalDeckRuns.push(run);
      finalCopies += finalCards.length;
      upgradedCopies += finalCards.filter((card) => Number(card?.upgradeLevel) > 0).length;
    }
  }

  const pickedCompleted = completedRuns(pickedRunObjects);
  const skippedCompleted = completedRuns(skippedRunObjects);
  const finalCompleted = completedRuns(finalDeckRuns);
  const baselineWinRate = completedWinRate(runs);
  const pickedWinRate = ratio(pickedCompleted.filter((run) => run.win).length, pickedCompleted.length);
  const skippedWinRate = ratio(skippedCompleted.filter((run) => run.win).length, skippedCompleted.length);
  const finalDeckWinRate = ratio(finalCompleted.filter((run) => run.win).length, finalCompleted.length);
  return {
    runs: runs.length,
    seenRuns: seenRuns.size,
    offered,
    picked,
    pickRate: ratio(picked, offered),
    pickedRuns: pickedRuns.size,
    skippedRuns: skippedRuns.size,
    pickedCompletedRuns: pickedCompleted.length,
    skippedCompletedRuns: skippedCompleted.length,
    pickedWinRate,
    skippedWinRate,
    pickDelta: pickedWinRate - skippedWinRate,
    baselineWinRate,
    pickedVsBaseline: pickedWinRate - baselineWinRate,
    avgPickFloor: average(pickFloors),
    pickFloorSamples: pickFloors.length,
    finalDeckRuns: finalDeckRuns.length,
    finalDeckCompletedRuns: finalCompleted.length,
    finalDeckShare: ratio(finalDeckRuns.length, runs.length),
    finalDeckWinRate,
    finalDeckVsBaseline: finalDeckWinRate - baselineWinRate,
    avgFinalCopies: ratio(finalCopies, finalDeckRuns.length),
    upgradedShare: ratio(upgradedCopies, finalCopies),
    avgFinalFloorWhenPicked: average(pickedRunObjects.map((run) => run.floor)),
    pickFloors,
    relatedRunIds: [...new Set([...pickedRuns, ...seenRuns])]
  };
}

export function cardDetailProfile(runs, id) {
  return {
    id,
    overall: cardDetailSlice(runs, id),
    byCharacter: itemCharacterRows(runs, (items) => cardDetailSlice(items, id))
  };
}

function encounterDetailSlice(runs, id) {
  const normalized = String(id);
  const events = [];
  const relatedRuns = [];
  for (const run of runs) {
    const matched = (run.encounterEvents || []).filter((event) => String(event.id) === normalized);
    if (!matched.length) continue;
    relatedRuns.push(run);
    for (const event of matched) events.push({ ...event, run });
  }
  const completedRelated = completedRuns(relatedRuns);
  const baselineWinRate = completedWinRate(runs);
  const runWinRate = ratio(completedRelated.filter((run) => run.win).length, completedRelated.length);
  const fights = events.length;
  const deaths = events.filter((event) => event.killedPlayer).length;
  return {
    runs: runs.length,
    relatedRuns: relatedRuns.length,
    completedRelatedRuns: completedRelated.length,
    fights,
    totalDamage: events.reduce((sum, event) => sum + (Number(event.damageTaken) || 0), 0),
    avgDamage: averageIncludingZero(events.map((event) => event.damageTaken)),
    avgTurns: average(events.map((event) => event.turns)),
    deaths,
    survivalRate: ratio(fights - deaths, fights),
    avgFloor: average(events.map((event) => event.floor)),
    runWinRate,
    baselineWinRate,
    runWinDelta: runWinRate - baselineWinRate,
    highDamageShare: ratio(events.filter((event) => Number(event.damageTaken) >= 20).length, fights),
    actRows: [1, 2, 3, 4].map((act) => {
      const actEvents = events.filter((event) => Number(event.act) === act);
      return {
        act,
        fights: actEvents.length,
        avgDamage: averageIncludingZero(actEvents.map((event) => event.damageTaken)),
        avgTurns: average(actEvents.map((event) => event.turns)),
        deaths: actEvents.filter((event) => event.killedPlayer).length
      };
    }).filter((row) => row.fights > 0),
    damageValues: events.map((event) => Number(event.damageTaken) || 0),
    floorValues: events.map((event) => Number(event.floor) || 0).filter((floor) => floor > 0),
    relatedRunIds: relatedRuns.map((run) => String(run.id))
  };
}

export function encounterDetailProfile(runs, id) {
  return {
    id,
    overall: encounterDetailSlice(runs, id),
    byCharacter: itemCharacterRows(runs, (items) => encounterDetailSlice(items, id))
  };
}

function relicDetailSlice(runs, id) {
  const relatedRuns = [];
  const acquisitionFloors = [];
  let offered = 0;
  let picked = 0;
  for (const run of runs) {
    for (const point of run.timeline || []) {
      for (const choice of point.relicChoices || []) {
        if (String(choice.id) !== String(id)) continue;
        offered += 1;
        if (choice.picked) picked += 1;
      }
    }
    const match = matchingRelics(run, id);
    if (!match.has) continue;
    relatedRuns.push(run);
    for (const relic of match.final) {
      const floor = Number(relic?.floorAdded) || 0;
      if (floor > 0) acquisitionFloors.push(floor);
    }
  }
  const completedRelated = completedRuns(relatedRuns);
  const baselineWinRate = completedWinRate(runs);
  const winRate = ratio(completedRelated.filter((run) => run.win).length, completedRelated.length);
  return {
    runs: runs.length,
    relatedRuns: relatedRuns.length,
    completedRelatedRuns: completedRelated.length,
    possessionRate: ratio(relatedRuns.length, runs.length),
    offered,
    picked,
    pickRate: ratio(picked, offered),
    winRate,
    baselineWinRate,
    delta: winRate - baselineWinRate,
    avgAcquisitionFloor: average(acquisitionFloors),
    acquisitionSamples: acquisitionFloors.length,
    acquisitionFloors,
    avgFinalFloor: average(relatedRuns.map((run) => run.floor)),
    avgDamageTaken: average(relatedRuns.map((run) => run.totalDamageTaken)),
    avgFinalHpRatio: averageIncludingZero(relatedRuns.filter((run) => Number(run.maxHp) > 0).map((run) => ratio(Number(run.finalHp) || 0, Number(run.maxHp) || 0))),
    avgDeckSize: average(relatedRuns.map((run) => run.deckSize)),
    relatedRunIds: relatedRuns.map((run) => String(run.id))
  };
}

export function relicDetailProfile(runs, id) {
  return {
    id,
    overall: relicDetailSlice(runs, id),
    byCharacter: itemCharacterRows(runs, (items) => relicDetailSlice(items, id))
  };
}

export function getCurrentStreak(runs) {
  const sorted = [...runs].sort((a, b) => Number(b.startTime) - Number(a.startTime) || b.id.localeCompare(a.id));
  let count = 0;
  for (const run of sorted) {
    if (!run.win) break;
    count += 1;
  }
  return count;
}

export function characterStats(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = run.character || 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return [...groups.entries()]
    .map(([character, items]) => ({ character, ...summarizeRuns(items) }))
    .sort((a, b) => b.total - a.total);
}

export function ascensionStats(runs) {
  const groups = new Map();
  for (const run of runs) {
    const level = Number(run.ascension) || 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(run);
  }
  return [...groups.entries()]
    .map(([ascension, items]) => ({ ascension, ...summarizeRuns(items) }))
    .sort((a, b) => a.ascension - b.ascension);
}

export function rollingWinRate(runs, windowSize = 10) {
  const sorted = runs.filter((run) => run.status !== 'abandoned').sort((a, b) => Number(a.startTime) - Number(b.startTime) || a.id.localeCompare(b.id));
  return sorted.map((run, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = sorted.slice(start, index + 1);
    return {
      index: index + 1,
      timestamp: run.startTime,
      value: ratio(window.filter((item) => item.win).length, window.length)
    };
  });
}

export function survivalByFloor(runs, maxFloor = 49) {
  const eligible = runs.filter((run) => run.status !== 'abandoned');
  return Array.from({ length: maxFloor }, (_, index) => {
    const floor = index + 1;
    return { floor, value: ratio(eligible.filter((run) => run.floor >= floor).length, eligible.length) };
  });
}

function shrunkenBinomial(successes, total, baseline, priorStrength = 12) {
  const n = Math.max(0, Number(total) || 0);
  const wins = Math.min(n, Math.max(0, Number(successes) || 0));
  const prior = Math.max(0, Number(priorStrength) || 0);
  const center = Math.min(1, Math.max(0, Number(baseline) || 0));
  const interval = wilsonInterval(wins, n);
  return {
    raw: ratio(wins, n),
    adjusted: ratio(wins + center * prior, n + prior),
    low: interval.low,
    high: interval.high,
    reliability: sampleReliability(n)
  };
}

export function cardStats(runs) {
  const stats = new Map();
  const runBaseline = summarizeRuns(runs).winRate;
  const ensure = (id) => {
    if (!stats.has(id)) stats.set(id, {
      id,
      offered: 0,
      picked: 0,
      pickedWins: 0,
      skippedWins: 0,
      pickedFloorsWin: [],
      pickedFloorsLoss: [],
      pickedRuns: new Set(),
      skippedRuns: new Set(),
      seenRuns: new Set()
    });
    return stats.get(id);
  };

  for (const run of runs) {
    const seenInRun = new Set();
    const pickedInRun = new Set();
    for (const choice of atomicCardChoices(run)) {
      const offered = new Set([...(choice.offered || []), choice.picked].filter(Boolean));
      for (const card of offered) {
        const row = ensure(card);
        row.offered += 1;
        seenInRun.add(card);
        row.seenRuns.add(run.id);
      }
      if (choice.picked) {
        const row = ensure(choice.picked);
        row.picked += 1;
        const floor = Number(choice.floor) || 0;
        if (floor > 0) (run.win ? row.pickedFloorsWin : row.pickedFloorsLoss).push(floor);
        if (!pickedInRun.has(choice.picked) && run.win) row.pickedWins += 1;
        row.pickedRuns.add(run.id);
        pickedInRun.add(choice.picked);
      }
    }
    for (const card of seenInRun) {
      if (pickedInRun.has(card)) continue;
      const row = ensure(card);
      row.skippedRuns.add(run.id);
      if (run.win) row.skippedWins += 1;
    }
  }

  return [...stats.values()].map((row) => {
    const picked = shrunkenBinomial(row.pickedWins, row.pickedRuns.size, runBaseline);
    const skipped = shrunkenBinomial(row.skippedWins, row.skippedRuns.size, runBaseline);
    const comparisonSamples = Math.min(row.pickedRuns.size, row.skippedRuns.size);
    return {
      name: zhEntity(row.id, 'cards', prettyId(row.id)),
      id: row.id,
      offered: row.offered,
      picked: row.picked,
      pickRate: ratio(row.picked, row.offered),
      rawWinRate: picked.raw,
      winRate: picked.adjusted,
      winCiLow: picked.low,
      winCiHigh: picked.high,
      skippedWinRate: skipped.adjusted,
      pickedRuns: row.pickedRuns.size,
      skippedRuns: row.skippedRuns.size,
      delta: picked.adjusted - skipped.adjusted,
      deltaCiLow: picked.low - skipped.high,
      deltaCiHigh: picked.high - skipped.low,
      avgPickedFloorWin: averageIncludingZero(row.pickedFloorsWin),
      avgPickedFloorLoss: averageIncludingZero(row.pickedFloorsLoss),
      pickedFloorWinSamples: row.pickedFloorsWin.length,
      pickedFloorLossSamples: row.pickedFloorsLoss.length,
      reliability: sampleReliability(comparisonSamples)
    };
  }).sort((a, b) => b.offered - a.offered);
}

function combatsAfterFloor(run, floor) {
  return (run.encounterEvents || []).filter((event) => Number(event.floor) > Number(floor || 0)).length;
}

export function weightedCardStats(runs, minCombats = 1) {
  const stats = new Map();
  for (const run of runs) {
    const seen = new Set();
    for (const card of run.deck || []) {
      const id = typeof card === 'string' ? card : card?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const combats = combatsAfterFloor(run, Number(card?.floorAdded) || 0);
      if (combats < minCombats) continue;
      if (!stats.has(id)) stats.set(id, { id, runs: 0, weightedWins: 0, combatWeight: 0 });
      const row = stats.get(id);
      row.runs += 1;
      row.combatWeight += combats;
      if (run.win) row.weightedWins += combats;
    }
  }
  return [...stats.values()].map((row) => ({ ...row, name: zhEntity(row.id, 'cards', prettyId(row.id)), weightedWinRate: ratio(row.weightedWins, row.combatWeight) })).sort((a, b) => b.combatWeight - a.combatWeight);
}

export function weightedRelicStats(runs, minCombats = 1) {
  const stats = new Map();
  for (const run of runs) {
    const seen = new Set();
    for (const relic of run.relics || []) {
      const id = typeof relic === 'string' ? relic : relic?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const combats = combatsAfterFloor(run, Number(relic?.floorAdded) || 0);
      if (combats < minCombats) continue;
      if (!stats.has(id)) stats.set(id, { id, runs: 0, weightedWins: 0, combatWeight: 0 });
      const row = stats.get(id);
      row.runs += 1;
      row.combatWeight += combats;
      if (run.win) row.weightedWins += combats;
    }
  }
  return [...stats.values()].map((row) => ({ ...row, name: zhEntity(row.id, 'relics', prettyId(row.id)), weightedWinRate: ratio(row.weightedWins, row.combatWeight) })).sort((a, b) => b.combatWeight - a.combatWeight);
}

function groupedWinRate(runs, keyFn) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.status !== 'abandoned')) {
    const key = keyFn(run);
    if (key === null || key === undefined || Number.isNaN(key)) continue;
    if (!groups.has(key)) groups.set(key, { key, total: 0, wins: 0 });
    const row = groups.get(key);
    row.total += 1;
    if (run.win) row.wins += 1;
  }
  return [...groups.values()].map((row) => ({ ...row, winRate: ratio(row.wins, row.total) }));
}

export function deckSizeStats(runs) {
  return groupedWinRate(runs, (run) => Number(run.deckSize) || 0).sort((a, b) => Number(a.key) - Number(b.key));
}

export function upgradeRateStats(runs) {
  return groupedWinRate(runs, (run) => {
    const deck = Number(run.deckSize) || 0;
    if (!deck) return null;
    return Math.round((((Number(run.upgradeCount) || 0) / deck) * 100) / 5) * 5;
  }).sort((a, b) => Number(a.key) - Number(b.key));
}

export function eliteDensityStats(runs) {
  return groupedWinRate(runs, (run) => {
    const combats = Number(run.combatCount) || 0;
    if (!combats) return null;
    return Math.round((((Number(run.eliteCount) || 0) / combats) * 100) / 5) * 5;
  }).sort((a, b) => Number(a.key) - Number(b.key));
}

export function damageSourceStats(runs) {
  const groups = new Map();
  for (const run of runs) {
    for (const event of run.damageSources || []) {
      const key = event.type || 'unknown';
      if (!groups.has(key)) groups.set(key, { type: key, totalDamage: 0, nodes: 0, runs: new Set() });
      const row = groups.get(key);
      row.totalDamage += Number(event.damageTaken) || 0;
      row.nodes += 1;
      row.runs.add(run.id);
    }
  }
  const grandTotal = [...groups.values()].reduce((sum, row) => sum + row.totalDamage, 0);
  return [...groups.values()].map((row) => ({
    type: row.type,
    name: zhMapType(row.type),
    totalDamage: row.totalDamage,
    nodes: row.nodes,
    runsHit: row.runs.size,
    share: ratio(row.totalDamage, grandTotal),
    avgPerRun: ratio(row.totalDamage, runs.length),
    avgWhenHit: ratio(row.totalDamage, row.runs.size)
  })).sort((a, b) => b.totalDamage - a.totalDamage);
}

function averageIncludingZero(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

export function damageByActStats(runs) {
  const acts = new Map();
  for (const run of runs) {
    const perRun = new Map();
    for (const event of run.damageSources || []) {
      const act = Number(event.act) || 1;
      perRun.set(act, (perRun.get(act) || 0) + (Number(event.damageTaken) || 0));
    }
    for (let act = 1; act <= Math.max(1, Number(run.actCount) || 1); act += 1) {
      if (!acts.has(act)) acts.set(act, []);
      acts.get(act).push(perRun.get(act) || 0);
    }
  }
  return [...acts.entries()].map(([act, values]) => ({ act, averageDamage: averageIncludingZero(values), runSamples: values.length })).sort((a, b) => a.act - b.act);
}

export function restSiteStats(runs) {
  const counter = new Map();
  for (const run of runs) {
    for (const event of run.restChoices || []) {
      const key = String(event.choice || 'Unknown').toUpperCase();
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  }
  const total = [...counter.values()].reduce((sum, count) => sum + count, 0);
  return [...counter.entries()].map(([choice, count]) => ({ choice, name: zhEntity(choice, 'rest_site_ui', prettyId(choice)), count, share: ratio(count, total) })).sort((a, b) => b.count - a.count);
}

export function deckEvolution(timeline, finalDeckSize = 0) {
  const events = [];
  let gained = 0;
  let removed = 0;
  for (const point of timeline || []) {
    gained += point.cardsGained?.length || 0;
    removed += point.cardsRemoved?.length || 0;
  }
  let size = Math.max(0, Number(finalDeckSize) - gained + removed);
  events.push({ floor: 0, size, label: '初始牌组', type: 'start' });
  for (const point of timeline || []) {
    for (const card of point.cardsGained || []) {
      size += 1;
      events.push({ floor: point.floor, size, label: `+ ${zhEntity(card.id, 'cards', prettyId(card.id))}`, type: 'gain' });
    }
    for (const card of point.cardsRemoved || []) {
      size = Math.max(0, size - 1);
      events.push({ floor: point.floor, size, label: `− ${zhEntity(card.id, 'cards', prettyId(card.id))}`, type: 'remove' });
    }
    for (const card of point.upgradedCards || []) {
      events.push({ floor: point.floor, size, label: `↑ ${zhEntity(card, 'cards', prettyId(card))}`, type: 'upgrade' });
    }
    for (const transform of point.cardsTransformed || []) {
      const from = transform.from?.id ? zhEntity(transform.from.id, 'cards', prettyId(transform.from.id)) : '卡牌';
      const to = transform.to?.id ? zhEntity(transform.to.id, 'cards', prettyId(transform.to.id)) : '卡牌';
      events.push({ floor: point.floor, size, label: `${from} → ${to}`, type: 'transform' });
    }
  }
  return events;
}

export function decisionTimeline(timeline) {
  const events = [];
  for (const point of timeline || []) {
    if (point.cardChoices?.length) {
      const picked = point.cardChoices.find((choice) => choice.picked);
      events.push({ floor: point.floor, type: 'card', title: picked ? `选择 ${zhEntity(picked.id, 'cards', prettyId(picked.id))}` : '跳过卡牌奖励', detail: point.cardChoices.map((choice) => zhEntity(choice.id, 'cards', prettyId(choice.id))).join(' · ') });
    }
    const pickedRelics = (point.relicChoices || []).filter((choice) => choice.picked);
    for (const relic of pickedRelics) events.push({ floor: point.floor, type: 'relic', title: `遗物：${zhEntity(relic.id, 'relics', prettyId(relic.id))}`, detail: '遗物选择' });
    for (const choice of point.restChoices || []) events.push({ floor: point.floor, type: 'rest', title: zhEntity(choice, 'rest_site_ui', prettyId(choice)), detail: '休息处选择' });
    for (const event of point.eventChoices || []) events.push({ floor: point.floor, type: 'event', title: zhRef(event.title), detail: '事件选择' });
    for (const ancient of (point.ancientChoices || []).filter((choice) => choice.chosen)) events.push({ floor: point.floor, type: 'ancient', title: zhRef(ancient.title), detail: '先古之民选择' });
    if (point.potionsUsed?.length) events.push({ floor: point.floor, type: 'potion', title: `使用 ${point.potionsUsed.map((id) => zhEntity(id, 'potions', prettyId(id))).join('、')}`, detail: '使用药水' });
    if (point.potionsDiscarded?.length) events.push({ floor: point.floor, type: 'potion', title: `丢弃 ${point.potionsDiscarded.map((id) => zhEntity(id, 'potions', prettyId(id))).join('、')}`, detail: '药水栏变化' });
    if (point.potionsBought?.length) events.push({ floor: point.floor, type: 'shop', title: `购买 ${point.potionsBought.map((id) => zhEntity(id, 'potions', prettyId(id))).join('、')}`, detail: '购买药水' });
    if (point.boughtRelics?.length) events.push({ floor: point.floor, type: 'shop', title: `购买遗物 ${point.boughtRelics.map((id) => zhEntity(id, 'relics', prettyId(id))).join('、')}`, detail: '商店购买' });
    if (point.boughtColorless?.length) events.push({ floor: point.floor, type: 'shop', title: `购买无色牌 ${point.boughtColorless.map((id) => zhEntity(id, 'cards', prettyId(id))).join('、')}`, detail: '商店购买' });
    if (point.relicsRemoved?.length) events.push({ floor: point.floor, type: 'relic', title: `移除遗物 ${point.relicsRemoved.map((id) => zhEntity(id, 'relics', prettyId(id))).join('、')}`, detail: '遗物栏变化' });
    if (point.upgradedCards?.length) events.push({ floor: point.floor, type: 'card', title: `升级 ${point.upgradedCards.map((id) => zhEntity(id, 'cards', prettyId(id))).join('、')}`, detail: '卡牌升级' });
    if (point.downgradedCards?.length) events.push({ floor: point.floor, type: 'card', title: `降级 ${point.downgradedCards.map((id) => zhEntity(id, 'cards', prettyId(id))).join('、')}`, detail: '卡牌降级' });
    for (const enchanted of point.enchantedCards || []) events.push({ floor: point.floor, type: 'card', title: `附魔 ${zhEntity(enchanted.card?.id, 'cards', prettyId(enchanted.card?.id))}`, detail: zhEntity(enchanted.enchantment, 'enchantments', prettyId(enchanted.enchantment)) });
    if (point.completedQuests?.length) events.push({ floor: point.floor, type: 'quest', title: `完成 ${point.completedQuests.map((id) => zhEntity(id, 'cards', prettyId(id))).join('、')}`, detail: '任务完成' });
  }
  return events.sort((a, b) => a.floor - b.floor);
}

export function encounterStats(runs) {
  const stats = new Map();
  for (const run of runs) {
    for (const event of run.encounterEvents || []) {
      if (!stats.has(event.id)) stats.set(event.id, { id: event.id, fights: 0, damage: 0, turns: 0, turnSamples: 0, deaths: 0 });
      const row = stats.get(event.id);
      row.fights += 1;
      row.damage += Number(event.damageTaken) || 0;
      if (event.turns) {
        row.turns += Number(event.turns) || 0;
        row.turnSamples += 1;
      }
      if (event.killedPlayer) row.deaths += 1;
    }
  }
  return [...stats.values()].map((row) => ({
    name: zhEntity(row.id, 'encounters', prettyId(row.id)),
    id: row.id,
    fights: row.fights,
    avgDamage: ratio(row.damage, row.fights),
    avgTurns: ratio(row.turns, row.turnSamples),
    deaths: row.deaths,
    survivalRate: 1 - ratio(row.deaths, row.fights)
  })).sort((a, b) => b.fights - a.fights);
}

export function relicStats(runs) {
  const stats = new Map();
  const baseline = summarizeRuns(runs).winRate;
  for (const run of runs) {
    for (const relic of new Set(run.relicEvents || [])) {
      if (!stats.has(relic)) stats.set(relic, { id: relic, runs: 0, wins: 0 });
      const row = stats.get(relic);
      row.runs += 1;
      if (run.win) row.wins += 1;
    }
  }
  return [...stats.values()].map((row) => {
    const estimate = shrunkenBinomial(row.wins, row.runs, baseline);
    return {
      name: zhEntity(row.id, 'relics', prettyId(row.id)),
      id: row.id,
      runs: row.runs,
      rawWinRate: estimate.raw,
      winRate: estimate.adjusted,
      delta: estimate.adjusted - baseline,
      winCiLow: estimate.low,
      winCiHigh: estimate.high,
      reliability: estimate.reliability
    };
  }).sort((a, b) => b.runs - a.runs);
}

// Career totals are reconstructed from the selected solo history, never progress.save.
export function careerFromRuns(runs) {
  const solo = runs.filter((run) => !run.isMultiplayer && run.playerCount <= 1 && run.players.length <= 1);
  return {
    source: 'solo-runs',
    summary: summarizeRuns(solo),
    characterStats: characterStats(solo),
    totalPlaytime: solo.reduce((sum, run) => sum + run.runTime, 0),
    floorsClimbed: solo.reduce((sum, run) => sum + run.floor, 0)
  };
}

export function getMaxWinStreak(runs) {
  let current = 0;
  let maximum = 0;
  for (const run of [...runs].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))) {
    current = run.win ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}
