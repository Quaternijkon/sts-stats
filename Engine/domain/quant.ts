// @ts-nocheck
import { buildPlayerTimeline, prettyId } from './parser.js';
import { zhEntity, zhMapType } from './i18n.js';

const COMBAT_TYPES = new Set(['monster', 'elite', 'boss']);
const PLAYER_METRIC_CACHE = new WeakMap();

export function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

export function mean(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

export function standardDeviation(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = mean(clean);
  const variance = clean.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / clean.length;
  return Math.sqrt(variance);
}

export function median(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function percentileRank(values, value) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length || !Number.isFinite(Number(value))) return .5;
  const below = clean.filter((entry) => entry < value).length;
  const equal = clean.filter((entry) => entry === value).length;
  return (below + equal * .5) / clean.length;
}

function pearson(xs, ys) {
  const pairs = xs.map((x, index) => [Number(x), Number(ys[index])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return 0;
  const xMean = mean(pairs.map(([x]) => x));
  const yMean = mean(pairs.map(([, y]) => y));
  let numerator = 0;
  let xSq = 0;
  let ySq = 0;
  for (const [x, y] of pairs) {
    const xd = x - xMean;
    const yd = y - yMean;
    numerator += xd * yd;
    xSq += xd * xd;
    ySq += yd * yd;
  }
  const denominator = Math.sqrt(xSq * ySq);
  return denominator ? numerator / denominator : 0;
}

export function wilsonInterval(successes, total, z = 1.96) {
  const n = Math.max(0, Number(total) || 0);
  const wins = Math.min(n, Math.max(0, Number(successes) || 0));
  if (!n) return { estimate: 0, low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / denominator;
  return { estimate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function sampleReliability(samples) {
  const n = Math.max(0, Number(samples) || 0);
  if (n >= 50) return { key: 'strong', label: '高', note: `${n} 个样本` };
  if (n >= 20) return { key: 'moderate', label: '中', note: `${n} 个样本` };
  return { key: 'limited', label: '低', note: `${n} 个样本` };
}

export function correlationInterval(correlation, samples, z = 1.96) {
  const n = Math.max(0, Number(samples) || 0);
  const r = Math.max(-.999999, Math.min(.999999, Number(correlation) || 0));
  if (n <= 3) return { low: -1, high: 1 };
  const fisher = .5 * Math.log((1 + r) / (1 - r));
  const margin = z / Math.sqrt(n - 3);
  const inverse = (value) => {
    const exp = Math.exp(2 * value);
    return (exp - 1) / (exp + 1);
  };
  return { low: inverse(fisher - margin), high: inverse(fisher + margin) };
}

export function filterRuns(runs, filters = {}) {
  return runs.filter((run) => {
    if (filters.gameMode && filters.gameMode !== 'all' && String(run.gameMode) !== filters.gameMode) return false;
    if (filters.build && filters.build !== 'all' && String(run.buildId) !== String(filters.build)) return false;
    if (filters.party === 'solo' && run.isMultiplayer) return false;
    if (filters.party === 'coop' && !run.isMultiplayer) return false;
    if (filters.character && filters.character !== 'all' && run.character !== filters.character) return false;
    if (Array.isArray(filters.ascensions) && filters.ascensions.length && !filters.ascensions.includes(Number(run.ascension) || 0)) return false;
    if (filters.ascension !== undefined && filters.ascension !== null && filters.ascension !== 'all' && Number(run.ascension) !== Number(filters.ascension)) return false;
    const startTime = Number(run.startTime) || 0;
    const startMs = startTime > 1e12 ? startTime : startTime * 1000;
    if (filters.dateFrom) {
      const from = Date.parse(`${filters.dateFrom}T00:00:00`);
      if (Number.isFinite(from) && (!startMs || startMs < from)) return false;
    }
    if (filters.dateTo) {
      const to = Date.parse(`${filters.dateTo}T23:59:59.999`);
      if (Number.isFinite(to) && (!startMs || startMs > to)) return false;
    }
    if (filters.outcome && filters.outcome !== 'all') {
      if (filters.outcome === 'completed' && run.status === 'abandoned') return false;
      if (filters.outcome === 'win' && !run.win) return false;
      if (filters.outcome === 'loss' && (run.win || run.status === 'abandoned')) return false;
      if (filters.outcome === 'abandoned' && run.status !== 'abandoned') return false;
    }
    if (Number(filters.minDuration) > 0 && Number(run.runTime) < Number(filters.minDuration)) return false;
    return true;
  });
}

export function filterRunsByPreferences(runs, settings = {}) {
  const ascensionScope = settings.ascensionScope === 'a10' ? 'a10' : 'all';
  const abandonPolicy = ['include', 'exclude-all', 'exclude-short'].includes(settings.abandonPolicy) ? settings.abandonPolicy : 'include';
  const shortAbandonSeconds = Math.max(1, Number(settings.shortAbandonMinutes) || 10) * 60;
  return runs.filter((run) => {
    if (ascensionScope === 'a10' && Number(run.ascension) !== 10) return false;
    if (run.status === 'abandoned') {
      if (abandonPolicy === 'exclude-all') return false;
      if (abandonPolicy === 'exclude-short' && Number(run.runTime || 0) <= shortAbandonSeconds) return false;
    }
    return true;
  });
}

export function playerRunMetrics(run, playerIndex = 0) {
  if (run && typeof run === 'object') {
    const cachedByPlayer = PLAYER_METRIC_CACHE.get(run);
    if (cachedByPlayer?.has(playerIndex)) return cachedByPlayer.get(playerIndex);
  }
  const timeline = buildPlayerTimeline(run, playerIndex);
  const player = run?.players?.[playerIndex] || run?.players?.[0] || {};
  const combat = timeline.filter((point) => COMBAT_TYPES.has(String(point.type).toLowerCase()));
  const hpPoints = timeline.filter((point) => Number(point.maxHp) > 0);
  const cardRewardPoints = timeline.filter((point) => point.cardChoices?.length);
  const restChoices = timeline.flatMap((point) => point.restChoices || []);
  const finalHpPoint = [...hpPoints].reverse().find((point) => Number(point.maxHp) > 0);
  const upgradesInFinalDeck = (player.deck || []).filter((card) => Number(card?.upgradeLevel) > 0).length;
  const goldGained = sum(timeline.map((point) => point.goldGained));
  const goldSpent = sum(timeline.map((point) => point.goldSpent));
  const goldLost = sum(timeline.map((point) => point.goldLost));
  const goldStolen = sum(timeline.map((point) => point.goldStolen));
  const damageTaken = sum(timeline.map((point) => point.damageTaken));
  const healing = sum(timeline.map((point) => point.hpHealed));
  const maxHpGained = sum(timeline.map((point) => point.maxHpGained));
  const maxHpLost = sum(timeline.map((point) => point.maxHpLost));
  const cardSkips = cardRewardPoints.filter((point) => !point.cardChoices.some((choice) => choice.picked)).length;
  const potionChoices = timeline.flatMap((point) => point.potionChoices || []);
  const potionsBought = sum(timeline.map((point) => point.potionsBought?.length || 0));
  const potionsDiscarded = sum(timeline.map((point) => point.potionsDiscarded?.length || 0));
  const relicsBought = sum(timeline.map((point) => point.boughtRelics?.length || 0));
  const colorlessBought = sum(timeline.map((point) => point.boughtColorless?.length || 0));
  const relicsRemoved = sum(timeline.map((point) => point.relicsRemoved?.length || 0));
  const cardsEnchanted = sum(timeline.map((point) => point.enchantedCards?.length || 0));
  const cardsDowngraded = sum(timeline.map((point) => point.downgradedCards?.length || 0));
  const questsCompleted = sum(timeline.map((point) => point.completedQuests?.length || 0));
  const elites = combat.filter((point) => String(point.type).toLowerCase() === 'elite').length;
  const lowHpNodes = hpPoints.filter((point) => safeRatio(point.hp, point.maxHp) <= .35).length;
  const criticalHpNodes = hpPoints.filter((point) => safeRatio(point.hp, point.maxHp) <= .2).length;
  const turnSamples = combat.filter((point) => Number(point.turns) > 0);
  const combatDamage = combat.map((point) => Number(point.damageTaken) || 0);
  const firstPoint = timeline[0];
  const initialGold = firstPoint ? Math.max(0,
    (Number(firstPoint.gold) || 0)
    - (Number(firstPoint.goldGained) || 0)
    + (Number(firstPoint.goldSpent) || 0)
    + (Number(firstPoint.goldLost) || 0)
    + (Number(firstPoint.goldStolen) || 0)
  ) : 0;
  const goldAvailable = initialGold + goldGained;
  const cardsGained = sum(timeline.map((point) => point.cardsGained?.length || 0));
  const cardsRemoved = sum(timeline.map((point) => point.cardsRemoved?.length || 0));
  const initialDeckSize = Math.max(0, (player.deck?.length || 0) - cardsGained + cardsRemoved);
  const hpPressure = mean(hpPoints.map((point) => 1 - safeRatio(point.hp, point.maxHp)));

  const result = {
    playerIndex,
    playerId: player.id,
    character: player.character || run.character || 'Unknown',
    floors: timeline.length,
    combats: combat.length,
    elites,
    eliteDensity: safeRatio(elites, combat.length),
    damageTaken,
    damagePerCombat: safeRatio(damageTaken, combat.length),
    damageStdDev: standardDeviation(combatDamage),
    maxCombatDamage: Math.max(0, ...combatDamage),
    healing,
    recoveryRatio: safeRatio(healing, damageTaken),
    avgTurns: mean(turnSamples.map((point) => point.turns)),
    lowHpNodes,
    criticalHpNodes,
    lowHpShare: safeRatio(lowHpNodes, hpPoints.length),
    hpPressure,
    finalHpRatio: finalHpPoint ? safeRatio(finalHpPoint.hp, finalHpPoint.maxHp) : 0,
    deckSize: player.deck?.length || 0,
    initialDeckSize,
    deckGrowth: (player.deck?.length || 0) - initialDeckSize,
    deckGrowthRate: safeRatio((player.deck?.length || 0) - initialDeckSize, initialDeckSize || 1),
    relicCount: player.relics?.length || 0,
    upgradeCount: upgradesInFinalDeck,
    upgradeDensity: safeRatio(upgradesInFinalDeck, player.deck?.length || 0),
    cardsGained,
    cardsRemoved,
    cardsTransformed: sum(timeline.map((point) => point.cardsTransformed?.length || 0)),
    cardRewards: cardRewardPoints.length,
    cardSkips,
    cardSkipRate: safeRatio(cardSkips, cardRewardPoints.length),
    goldGained,
    goldSpent,
    goldLost,
    goldStolen,
    finalGold: timeline.at(-1)?.gold || 0,
    initialGold,
    goldAvailable,
    goldSpendRate: safeRatio(goldSpent, goldAvailable),
    goldLeakRate: safeRatio(goldLost + goldStolen, goldAvailable),
    goldCarryRate: safeRatio(timeline.at(-1)?.gold || 0, goldAvailable),
    maxHpGained,
    maxHpLost,
    maxHpNet: maxHpGained - maxHpLost,
    potionPicks: potionChoices.filter((choice) => choice.picked).length,
    potionsUsed: sum(timeline.map((point) => point.potionsUsed?.length || 0)),
    potionsBought,
    potionsDiscarded,
    potionUseRate: safeRatio(sum(timeline.map((point) => point.potionsUsed?.length || 0)), potionChoices.filter((choice) => choice.picked).length + potionsBought),
    relicsBought,
    colorlessBought,
    relicsRemoved,
    cardsEnchanted,
    cardsDowngraded,
    questsCompleted,
    restCount: restChoices.length,
    smithCount: restChoices.filter((choice) => String(choice).toUpperCase().includes('SMITH')).length,
    healRestCount: restChoices.filter((choice) => /HEAL|REST|SLEEP/i.test(String(choice))).length,
    secondsPerFloor: safeRatio(Number(run.runTime) || 0, timeline.length),
    timeline
  };
  if (run && typeof run === 'object') {
    let cachedByPlayer = PLAYER_METRIC_CACHE.get(run);
    if (!cachedByPlayer) {
      cachedByPlayer = new Map();
      PLAYER_METRIC_CACHE.set(run, cachedByPlayer);
    }
    cachedByPlayer.set(playerIndex, result);
  }
  return result;
}

export function performanceTrend(runs, window = 20) {
  const completed = [...runs].filter((run) => run.status !== 'abandoned').sort((a, b) => Number(a.startTime) - Number(b.startTime));
  const recent = completed.slice(-window);
  const prior = completed.slice(Math.max(0, completed.length - window * 2), Math.max(0, completed.length - window));
  const lifetime = completed.slice(0, Math.max(0, completed.length - recent.length));
  const summarize = (items) => ({
    runs: items.length,
    winRate: safeRatio(items.filter((run) => run.win).length, items.length),
    avgFloor: mean(items.map((run) => run.floor)),
    avgDamage: mean(items.map((run) => playerRunMetrics(run).damagePerCombat))
  });
  return { recent: summarize(recent), prior: summarize(prior), baseline: summarize(lifetime.length ? lifetime : prior) };
}

export function runMetricRows(runs) {
  return runs.filter((run) => run.status !== 'abandoned').map((run) => ({
    runId: run.id,
    startTime: run.startTime,
    win: run.win ? 1 : 0,
    floor: Number(run.floor) || 0,
    runTime: Number(run.runTime) || 0,
    ascension: Number(run.ascension) || 0,
    playerCount: Number(run.playerCount) || 1,
    gameMode: run.gameMode || 'unknown',
    ...playerRunMetrics(run, 0)
  }));
}

export function rollingMetricSeries(runs, window = 15) {
  const rows = runMetricRows(runs).sort((a, b) => Number(a.startTime) - Number(b.startTime));
  return rows.map((row, index) => {
    const sample = rows.slice(Math.max(0, index - window + 1), index + 1);
    return {
      index: index + 1,
      startTime: row.startTime,
      sample: sample.length,
      winRate: mean(sample.map((item) => item.win)),
      damagePerCombat: mean(sample.map((item) => item.damagePerCombat)),
      lowHpShare: mean(sample.map((item) => item.lowHpShare)),
      upgradeDensity: mean(sample.map((item) => item.upgradeDensity)),
      deckSize: mean(sample.map((item) => item.deckSize)),
      secondsPerFloor: mean(sample.map((item) => item.secondsPerFloor))
    };
  });
}

export function histogram(values, binCount = 10, forcedMin = null, forcedMax = null) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return [];
  const min = forcedMin === null ? Math.min(...clean) : Number(forcedMin);
  const rawMax = forcedMax === null ? Math.max(...clean) : Number(forcedMax);
  const max = rawMax === min ? min + 1 : rawMax;
  const width = (max - min) / Math.max(1, binCount);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    start: min + index * width,
    end: index === binCount - 1 ? max : min + (index + 1) * width,
    count: 0
  }));
  for (const value of clean) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)));
    bins[index].count += 1;
  }
  return bins.map((bin) => ({ ...bin, midpoint: (bin.start + bin.end) / 2, share: safeRatio(bin.count, clean.length) }));
}

export function distributionProfiles(runs) {
  const rows = runMetricRows(runs);
  const withRunIds = (bins, key) => bins.map((bin, index) => ({
    ...bin,
    runIds: rows.filter((row) => {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) return false;
      return value >= bin.start && (index === bins.length - 1 ? value <= bin.end : value < bin.end);
    }).map((row) => row.runId)
  }));
  const damagePerCombat = histogram(rows.map((row) => row.damagePerCombat), 12);
  const deckSize = histogram(rows.map((row) => row.deckSize), 12);
  return {
    damagePerCombat: withRunIds(damagePerCombat, 'damagePerCombat'),
    deckSize: withRunIds(deckSize, 'deckSize'),
    lowHpShare: histogram(rows.map((row) => row.lowHpShare), 10, 0, 1),
    runMinutes: histogram(rows.map((row) => row.runTime / 60), 12)
  };
}

export function metricCorrelations(runs) {
  const rows = runMetricRows(runs);
  const fields = [
    ['damagePerCombat', '每场战斗承伤'],
    ['damageStdDev', '承伤波动'],
    ['lowHpShare', '低血量暴露'],
    ['hpPressure', '生命压力'],
    ['avgTurns', '每场战斗回合数'],
    ['deckSize', '最终牌组规模'],
    ['deckGrowthRate', '牌组增长'],
    ['upgradeDensity', '升级密度'],
    ['eliteDensity', '精英密度'],
    ['cardSkipRate', '卡牌跳过率'],
    ['goldSpendRate', '金币花费率'],
    ['goldLeakRate', '金币损失率'],
    ['finalGold', '最终金币'],
    ['recoveryRatio', '恢复比例'],
    ['secondsPerFloor', '每层用时']
  ];
  return fields.map(([key, label]) => {
    const samples = rows.filter((row) => Number.isFinite(Number(row[key]))).length;
    const winCorrelation = pearson(rows.map((row) => row[key]), rows.map((row) => row.win));
    const floorCorrelation = pearson(rows.map((row) => row[key]), rows.map((row) => row.floor));
    const winInterval = correlationInterval(winCorrelation, samples);
    return {
      key,
      label,
      samples,
      reliability: sampleReliability(samples),
      winCorrelation,
      winCiLow: winInterval.low,
      winCiHigh: winInterval.high,
      floorCorrelation
    };
  }).sort((a, b) => Math.abs(b.winCorrelation) - Math.abs(a.winCorrelation));
}

export function routeProfile(runs) {
  const counts = new Map();
  let nodes = 0;
  for (const run of runs) {
    for (const point of run.map || []) {
      const type = String(point.map_point_type || 'unknown').toLowerCase();
      counts.set(type, (counts.get(type) || 0) + 1);
      nodes += 1;
    }
  }
  return [...counts.entries()].map(([type, count]) => ({
    type,
    name: zhMapType(type),
    count,
    share: safeRatio(count, nodes),
    avgPerRun: safeRatio(count, runs.length)
  })).sort((a, b) => b.count - a.count);
}

export function floorRiskProfile(runs, maxFloor = 60) {
  const eligible = runs.filter((run) => run.status !== 'abandoned');
  const total = eligible.length;
  const rows = [];
  for (let floor = 1; floor <= maxFloor; floor += 1) {
    const reachedRuns = eligible.filter((run) => Number(run.floor) >= floor);
    if (!reachedRuns.length) break;
    const points = reachedRuns.map((run) => playerRunMetrics(run).timeline.find((point) => Number(point.floor) === floor)).filter(Boolean);
    const hpPoints = points.filter((point) => Number(point.maxHp) > 0);
    const deaths = eligible.filter((run) => !run.win && Number(run.floor) === floor).length;
    const interval = wilsonInterval(deaths, reachedRuns.length);
    rows.push({
      floor,
      reached: reachedRuns.length,
      survival: safeRatio(reachedRuns.length, total),
      deaths,
      hazard: safeRatio(deaths, reachedRuns.length),
      hazardLow: interval.low,
      hazardHigh: interval.high,
      reliability: sampleReliability(reachedRuns.length),
      avgDamage: mean(points.map((point) => point.damageTaken)),
      avgHpRatio: mean(hpPoints.map((point) => safeRatio(point.hp, point.maxHp))),
      lowHpShare: safeRatio(hpPoints.filter((point) => safeRatio(point.hp, point.maxHp) <= .35).length, hpPoints.length)
    });
  }
  return rows;
}

export function actFloorRiskProfile(runs) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.status !== 'abandoned')) {
    for (const point of playerRunMetrics(run).timeline) {
      const key = `${point.act}:${point.actFloor}`;
      if (!groups.has(key)) groups.set(key, { act: point.act, actFloor: point.actFloor, samples: 0, damage: [], hpRatios: [], lowHp: 0, runIds: new Set() });
      const row = groups.get(key);
      row.samples += 1;
      row.runIds.add(String(run.id));
      row.damage.push(Number(point.damageTaken) || 0);
      if (point.maxHp > 0) {
        const hpRatio = safeRatio(point.hp, point.maxHp);
        row.hpRatios.push(hpRatio);
        if (hpRatio <= .35) row.lowHp += 1;
      }
    }
  }
  return [...groups.values()].map((row) => ({
    act: row.act,
    actFloor: row.actFloor,
    samples: row.samples,
    avgDamage: mean(row.damage),
    avgHpRatio: mean(row.hpRatios),
    lowHpShare: safeRatio(row.lowHp, row.hpRatios.length),
    runIds: [...row.runIds]
  })).sort((a, b) => a.act - b.act || a.actFloor - b.actFloor);
}

export function routeOutcomeProfile(runs) {
  const outcomes = { win: new Map(), loss: new Map() };
  const totals = { win: 0, loss: 0 };
  for (const run of runs.filter((item) => item.status !== 'abandoned')) {
    const outcome = run.win ? 'win' : 'loss';
    for (const point of run.map || []) {
      const type = String(point.map_point_type || 'unknown').toLowerCase();
      outcomes[outcome].set(type, (outcomes[outcome].get(type) || 0) + 1);
      totals[outcome] += 1;
    }
  }
  const keys = new Set([...outcomes.win.keys(), ...outcomes.loss.keys()]);
  return [...keys].map((type) => {
    const winShare = safeRatio(outcomes.win.get(type) || 0, totals.win);
    const lossShare = safeRatio(outcomes.loss.get(type) || 0, totals.loss);
    return { type, name: zhMapType(type), winShare, lossShare, delta: winShare - lossShare };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function resourceProfile(runs) {
  const metrics = runs.map((run) => playerRunMetrics(run));
  return {
    avgDamage: mean(metrics.map((row) => row.damageTaken)),
    damagePerCombat: mean(metrics.map((row) => row.damagePerCombat)),
    avgHealing: mean(metrics.map((row) => row.healing)),
    avgGoldGained: mean(metrics.map((row) => row.goldGained)),
    avgGoldSpent: mean(metrics.map((row) => row.goldSpent)),
    avgGoldLost: mean(metrics.map((row) => row.goldLost + row.goldStolen)),
    avgFinalGold: mean(metrics.map((row) => row.finalGold)),
    avgMaxHpNet: mean(metrics.map((row) => row.maxHpNet)),
    lowHpShare: mean(metrics.map((row) => row.lowHpShare)),
    cardSkipRate: safeRatio(sum(metrics.map((row) => row.cardSkips)), sum(metrics.map((row) => row.cardRewards))),
    upgradeDensity: mean(metrics.map((row) => row.upgradeDensity)),
    potionUsePerRun: mean(metrics.map((row) => row.potionsUsed)),
    potionUseRate: safeRatio(sum(metrics.map((row) => row.potionsUsed)), sum(metrics.map((row) => row.potionPicks + row.potionsBought))),
    potionDiscardPerRun: mean(metrics.map((row) => row.potionsDiscarded)),
    relicsBoughtPerRun: mean(metrics.map((row) => row.relicsBought)),
    colorlessBoughtPerRun: mean(metrics.map((row) => row.colorlessBought)),
    enchantedCardsPerRun: mean(metrics.map((row) => row.cardsEnchanted)),
    downgradedCardsPerRun: mean(metrics.map((row) => row.cardsDowngraded)),
    questsPerRun: mean(metrics.map((row) => row.questsCompleted))
  };
}

export function buildVersionProfile(runs) {
  const completed = runs.filter((item) => item.status !== 'abandoned');
  const groups = new Map();
  const baselineFor = (run) => {
    const otherBuilds = completed.filter((candidate) => candidate.id !== run.id && candidate.buildId !== run.buildId);
    let peers = otherBuilds.filter((candidate) => candidate.gameMode === run.gameMode
      && candidate.playerCount === run.playerCount
      && candidate.character === run.character
      && Math.abs(Number(candidate.ascension) - Number(run.ascension)) <= 1);
    if (peers.length < 5) peers = otherBuilds.filter((candidate) => candidate.gameMode === run.gameMode && candidate.playerCount === run.playerCount && candidate.character === run.character);
    if (peers.length < 3) peers = otherBuilds.filter((candidate) => candidate.gameMode === run.gameMode && candidate.playerCount === run.playerCount);
    if (!peers.length) peers = otherBuilds;
    return peers.length ? safeRatio(peers.filter((candidate) => candidate.win).length, peers.length) : 0;
  };
  for (const run of completed) {
    const key = run.buildId || 'Unknown';
    if (!groups.has(key)) groups.set(key, { buildId: key, runs: 0, wins: 0, floor: 0, damage: 0, lowHp: 0, duration: 0, expectedWins: 0 });
    const row = groups.get(key);
    const metrics = playerRunMetrics(run);
    row.runs += 1;
    row.wins += run.win ? 1 : 0;
    row.floor += Number(run.floor) || 0;
    row.damage += metrics.damagePerCombat;
    row.lowHp += metrics.lowHpShare;
    row.duration += Number(run.runTime) || 0;
    row.expectedWins += baselineFor(run);
  }
  return [...groups.values()].map((row) => {
    const interval = wilsonInterval(row.wins, row.runs);
    const expectedWinRate = safeRatio(row.expectedWins, row.runs);
    return {
      buildId: row.buildId,
      runs: row.runs,
      wins: row.wins,
      winRate: safeRatio(row.wins, row.runs),
      winCiLow: interval.low,
      winCiHigh: interval.high,
      reliability: sampleReliability(row.runs),
      expectedWinRate,
      adjustedWinDelta: safeRatio(row.wins - row.expectedWins, row.runs),
      avgFloor: safeRatio(row.floor, row.runs),
      damagePerCombat: safeRatio(row.damage, row.runs),
      lowHpShare: safeRatio(row.lowHp, row.runs),
      avgRunTime: safeRatio(row.duration, row.runs)
    };
  }).sort((a, b) => String(a.buildId).localeCompare(String(b.buildId), undefined, { numeric: true }));
}

export function decisionEventProfile(runs) {
  const metrics = runs.map((run) => playerRunMetrics(run));
  return [
    ['使用药水', 'potionsUsed'],
    ['购买药水', 'potionsBought'],
    ['丢弃药水', 'potionsDiscarded'],
    ['购买遗物', 'relicsBought'],
    ['购买无色牌', 'colorlessBought'],
    ['移除遗物', 'relicsRemoved'],
    ['附魔卡牌', 'cardsEnchanted'],
    ['降级卡牌', 'cardsDowngraded'],
    ['完成任务', 'questsCompleted']
  ].map(([label, key]) => ({
    key,
    label,
    total: sum(metrics.map((row) => row[key])),
    avgPerRun: mean(metrics.map((row) => row[key])),
    runsWithEvent: metrics.filter((row) => Number(row[key]) > 0).length,
    runShare: safeRatio(metrics.filter((row) => Number(row[key]) > 0).length, metrics.length)
  })).sort((a, b) => b.total - a.total);
}

export function lifetimeEnemyProfile(progress) {
  return (progress?.enemyStats || []).map((row) => {
    const wins = sum(row.characters.map((entry) => entry.wins));
    const losses = sum(row.characters.map((entry) => entry.losses));
    return { id: row.id, wins, losses, fights: wins + losses, lossRate: safeRatio(losses, wins + losses) };
  }).filter((row) => row.fights > 0).sort((a, b) => b.lossRate - a.lossRate || b.losses - a.losses);
}

export function lifetimeEnemyCharacterProfile(progress, minFights = 15) {
  const characters = [...new Set((progress?.enemyStats || []).flatMap((row) => row.characters || []).map((entry) => entry.character).filter(Boolean))].sort();
  const rows = (progress?.enemyStats || []).map((row) => {
    const cells = Object.fromEntries(characters.map((character) => {
      const entry = (row.characters || []).find((item) => item.character === character);
      const wins = Number(entry?.wins) || 0;
      const losses = Number(entry?.losses) || 0;
      return [character, { fights: wins + losses, wins, losses, lossRate: safeRatio(losses, wins + losses) }];
    }));
    const fights = Object.values(cells).reduce((total, cell) => total + cell.fights, 0);
    const losses = Object.values(cells).reduce((total, cell) => total + cell.losses, 0);
    return { id: row.id, fights, losses, lossRate: safeRatio(losses, fights), cells };
  }).filter((row) => row.fights >= minFights).sort((a, b) => b.lossRate - a.lossRate || b.losses - a.losses);
  return { characters, rows };
}

export function lifetimeEpochSeries(progress) {
  const rows = [...(progress?.epochs || [])]
    .filter((row) => Number(row.obtainDate) > 0)
    .sort((a, b) => Number(a.obtainDate) - Number(b.obtainDate));
  return rows.map((row, index) => ({
    index: index + 1,
    obtainDate: Number(row.obtainDate),
    unlocks: index + 1,
    id: row.id,
    state: row.state
  }));
}

export function lifetimeDiscoveryProfile(progress) {
  const discoveries = progress?.discoveries || {};
  return [
    ['卡牌', discoveries.cards?.length || 0],
    ['遗物', discoveries.relics?.length || 0],
    ['药水', discoveries.potions?.length || 0],
    ['事件', discoveries.events?.length || 0],
    ['阶段', discoveries.acts?.length || 0]
  ].map(([label, count]) => ({ label, count }));
}

export function actBreakdown(run, playerIndex = 0) {
  const metrics = playerRunMetrics(run, playerIndex);
  const acts = new Map();
  for (const point of metrics.timeline) {
    const act = Number(point.act) || 1;
    if (!acts.has(act)) acts.set(act, { act, nodes: 0, combats: 0, elites: 0, damage: 0, healing: 0, goldSpent: 0, goldLost: 0, lowHpNodes: 0, hpSamples: 0 });
    const row = acts.get(act);
    row.nodes += 1;
    if (COMBAT_TYPES.has(String(point.type).toLowerCase())) row.combats += 1;
    if (String(point.type).toLowerCase() === 'elite') row.elites += 1;
    row.damage += Number(point.damageTaken) || 0;
    row.healing += Number(point.hpHealed) || 0;
    row.goldSpent += Number(point.goldSpent) || 0;
    row.goldLost += (Number(point.goldLost) || 0) + (Number(point.goldStolen) || 0);
    if (point.maxHp) {
      row.hpSamples += 1;
      if (safeRatio(point.hp, point.maxHp) <= .35) row.lowHpNodes += 1;
    }
  }
  return [...acts.values()].map((row) => ({ ...row, damagePerCombat: safeRatio(row.damage, row.combats), lowHpShare: safeRatio(row.lowHpNodes, row.hpSamples) }));
}

export function criticalMoments(run, playerIndex = 0) {
  const timeline = buildPlayerTimeline(run, playerIndex);
  const moments = [];
  for (const point of timeline) {
    const hpRatio = safeRatio(point.hp, point.maxHp);
    const severeHit = point.damageTaken >= Math.max(12, point.maxHp * .2);
    if (severeHit) moments.push({ floor: point.floor, severity: point.damageTaken >= point.maxHp * .35 ? 3 : 2, type: 'damage', title: `在${zhEntity(point.label, null, prettyId(point.label))}承受 ${point.damageTaken} 点伤害`, detail: `节点结束后 HP ${point.hp}/${point.maxHp}` });
    if (point.maxHp && hpRatio <= .2) moments.push({ floor: point.floor, severity: 3, type: 'hp', title: '极低血量区间', detail: `剩余 HP ${Math.round(hpRatio * 100)}%` });
    else if (point.maxHp && hpRatio <= .35) moments.push({ floor: point.floor, severity: 2, type: 'hp', title: '低血量压力', detail: `剩余 HP ${Math.round(hpRatio * 100)}%` });
    if (point.goldSpent >= 100) moments.push({ floor: point.floor, severity: 1, type: 'gold', title: `花费 ${point.goldSpent} 金币`, detail: zhEntity(point.label, null, prettyId(point.label)) });
    const lost = (Number(point.goldLost) || 0) + (Number(point.goldStolen) || 0);
    if (lost > 0) moments.push({ floor: point.floor, severity: 2, type: 'gold', title: `损失 ${lost} 金币`, detail: point.goldStolen ? '包含被偷金币' : zhEntity(point.label, null, prettyId(point.label)) });
    if (point.maxHpGained || point.maxHpLost) moments.push({ floor: point.floor, severity: 1, type: 'maxhp', title: `最大 HP ${point.maxHpGained ? `+${point.maxHpGained}` : `−${point.maxHpLost}`}`, detail: zhEntity(point.label, null, prettyId(point.label)) });
    if (point.potionsUsed?.length) moments.push({ floor: point.floor, severity: 1, type: 'potion', title: `使用 ${point.potionsUsed.map((id) => zhEntity(id, 'potions', prettyId(id))).join('、')}`, detail: zhEntity(point.label, null, prettyId(point.label)) });
  }
  return moments.sort((a, b) => a.floor - b.floor || b.severity - a.severity).slice(0, 20);
}

export function benchmarkRun(run, runs, playerIndex = 0) {
  const current = playerRunMetrics(run, playerIndex);
  const peers = comparablePeers(run, runs, playerIndex);
  const peerMetrics = peers.map((candidate) => playerRunMetrics(candidate, Math.min(playerIndex, Math.max(0, (candidate.players?.length || 1) - 1))));
  const fields = [
    ['damagePerCombat', '每场战斗承伤', 'lower'],
    ['lowHpShare', '低血量暴露', 'lower'],
    ['avgTurns', '每场战斗回合数', 'lower'],
    ['upgradeDensity', '升级密度', 'higher'],
    ['eliteDensity', '精英密度', 'neutral'],
    ['deckSize', '最终牌组规模', 'neutral'],
    ['cardSkipRate', '卡牌跳过率', 'neutral'],
    ['finalHpRatio', '最终 HP 比例', 'higher']
  ];
  const metrics = fields.map(([key, label, direction]) => {
    const values = peerMetrics.map((row) => row[key]);
    const percentile = percentileRank(values, current[key]);
    return { key, label, direction, value: current[key], peerMedian: median(values), percentile, relative: percentile >= .75 ? 'high' : percentile <= .25 ? 'low' : 'typical' };
  });
  const byKey = Object.fromEntries(metrics.map((row) => [row.key, row]));
  const signals = [];
  if (byKey.damagePerCombat?.percentile >= .8) signals.push({ tone: 'negative', title: '承伤压力偏高', detail: `每场战斗承伤高于 ${Math.round(byKey.damagePerCombat.percentile * 100)}% 的可比游戏。` });
  if (byKey.lowHpShare?.percentile >= .8) signals.push({ tone: 'negative', title: '长时间处于低血量', detail: '低血量节点占比在当前同类游戏中明显偏高。' });
  if (byKey.upgradeDensity?.percentile <= .2) signals.push({ tone: 'warning', title: '升级密度偏低', detail: `最终牌组升级密度位于同类游戏后 ${Math.max(1, Math.round(byKey.upgradeDensity.percentile * 100))}%。` });
  if (byKey.eliteDensity?.percentile >= .8) signals.push({ tone: 'info', title: '精英路线偏激进', detail: '精英密度高于大多数可比游戏。' });
  if (byKey.damagePerCombat?.percentile <= .2) signals.push({ tone: 'positive', title: 'HP 保存效率较高', detail: '每场战斗承伤处于当前同类游戏的较低水平。' });
  return { current, peers: peers.length, metrics, signals: signals.slice(0, 5) };
}

function comparablePeers(run, runs, playerIndex = 0) {
  const character = playerRunMetrics(run, playerIndex).character;
  const completed = runs.filter((candidate) => candidate.id !== run.id && candidate.status !== 'abandoned');
  const candidates = completed.filter((candidate) => candidate.gameMode === run.gameMode && candidate.playerCount === run.playerCount);
  let peers = candidates.filter((candidate) => (candidate.players?.[playerIndex]?.character || candidate.character) === character && Math.abs(Number(candidate.ascension) - Number(run.ascension)) <= 1);
  if (peers.length < 8) peers = candidates.filter((candidate) => (candidate.players?.[playerIndex]?.character || candidate.character) === character);
  if (peers.length < 5) peers = candidates;
  if (!peers.length) peers = completed.filter((candidate) => candidate.playerCount === run.playerCount);
  if (!peers.length) peers = completed;
  return peers;
}

export function benchmarkTrajectory(run, runs, playerIndex = 0) {
  const currentTimeline = buildPlayerTimeline(run, playerIndex);
  const peers = comparablePeers(run, runs, playerIndex);
  const peerTimelines = peers.map((candidate) => buildPlayerTimeline(candidate, Math.min(playerIndex, Math.max(0, (candidate.players?.length || 1) - 1))));
  let cumulativeDamage = 0;
  return currentTimeline.map((point) => {
    cumulativeDamage += Number(point.damageTaken) || 0;
    const hpRatios = [];
    const cumulativePeerSamples = [];
    peerTimelines.forEach((timeline) => {
      const peerPoint = timeline.find((candidate) => Number(candidate.floor) === Number(point.floor));
      if (!peerPoint) return;
      cumulativePeerSamples.push(sum(timeline.filter((candidate) => Number(candidate.floor) <= Number(point.floor)).map((candidate) => candidate.damageTaken)));
      if (peerPoint.maxHp > 0) hpRatios.push(safeRatio(peerPoint.hp, peerPoint.maxHp));
    });
    return {
      floor: point.floor,
      currentHpRatio: point.maxHp > 0 ? safeRatio(point.hp, point.maxHp) : null,
      peerMedianHpRatio: hpRatios.length ? median(hpRatios) : null,
      cumulativeDamage,
      peerMedianCumulativeDamage: cumulativePeerSamples.length ? median(cumulativePeerSamples) : null,
      peerSamples: Math.max(hpRatios.length, cumulativePeerSamples.length)
    };
  });
}

export function playerCountStats(runs) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.status !== 'abandoned')) {
    const count = Number(run.playerCount) || 1;
    if (!groups.has(count)) groups.set(count, { players: count, runs: 0, wins: 0 });
    const row = groups.get(count); row.runs += 1; if (run.win) row.wins += 1;
  }
  return [...groups.values()].map((row) => ({ ...row, winRate: safeRatio(row.wins, row.runs) })).sort((a, b) => a.players - b.players);
}

export function teamCompositionStats(runs) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.isMultiplayer && item.status !== 'abandoned')) {
    const characters = (run.players || []).map((player) => player.character || 'Unknown').sort();
    const key = characters.join(' + ');
    if (!groups.has(key)) groups.set(key, { composition: key, runs: 0, wins: 0, playerCount: characters.length, damage: 0 });
    const row = groups.get(key); row.runs += 1; if (run.win) row.wins += 1;
    row.damage += sum((run.players || []).map((_, index) => playerRunMetrics(run, index).damageTaken));
  }
  return [...groups.values()].map((row) => ({ ...row, winRate: safeRatio(row.wins, row.runs), avgTeamDamage: safeRatio(row.damage, row.runs) })).sort((a, b) => b.runs - a.runs);
}

export function teammateStats(runs) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.isMultiplayer)) {
    for (const player of (run.players || []).slice(1)) {
      const id = String(player.id);
      if (!groups.has(id)) groups.set(id, { id, runs: 0, wins: 0, characters: new Map() });
      const row = groups.get(id); row.runs += 1; if (run.win) row.wins += 1;
      row.characters.set(player.character, (row.characters.get(player.character) || 0) + 1);
    }
  }
  return [...groups.values()].map((row) => ({
    id: row.id,
    label: `玩家 …${row.id.slice(-5)}`,
    runs: row.runs,
    wins: row.wins,
    winRate: safeRatio(row.wins, row.runs),
    characters: [...row.characters.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(' · ')
  })).sort((a, b) => b.runs - a.runs);
}

export function teamRunSummary(run) {
  const players = (run.players || []).map((player, index) => ({ player, ...playerRunMetrics(run, index) }));
  const totalDamage = sum(players.map((row) => row.damageTaken));
  const totalHealing = sum(players.map((row) => row.healing));
  const totalGoldSpent = sum(players.map((row) => row.goldSpent));
  const timelines = players.map((_, index) => buildPlayerTimeline(run, index));
  const floors = Math.max(0, ...timelines.map((timeline) => timeline.length));
  const pressure = [];
  for (let index = 0; index < floors; index += 1) {
    const points = timelines.map((timeline) => timeline[index]).filter(Boolean);
    const hpRatios = points.filter((point) => point.maxHp > 0).map((point) => safeRatio(point.hp, point.maxHp));
    pressure.push({
      floor: points[0]?.floor || index + 1,
      act: points[0]?.act || 1,
      actFloor: points[0]?.actFloor || index + 1,
      avgHpRatio: mean(hpRatios),
      minHpRatio: hpRatios.length ? Math.min(...hpRatios) : 0,
      lowPlayers: hpRatios.filter((value) => value <= .35).length,
      criticalPlayers: hpRatios.filter((value) => value <= .2).length,
      teamDamage: sum(points.map((point) => point.damageTaken)),
      teamHealing: sum(points.map((point) => point.hpHealed))
    });
  }
  const simultaneousLowHpNodes = pressure.filter((point) => point.lowPlayers >= Math.min(2, players.length)).length;
  return {
    players: players.map((row) => ({
      ...row,
      damageShare: safeRatio(row.damageTaken, totalDamage),
      healingShare: safeRatio(row.healing, totalHealing),
      goldSpentShare: safeRatio(row.goldSpent, totalGoldSpent)
    })),
    totalDamage,
    totalHealing,
    totalGoldSpent,
    pressure,
    simultaneousLowHpNodes,
    criticalTeamNodes: pressure.filter((point) => point.criticalPlayers >= Math.ceil(players.length / 2)).length,
    avgTeamHpRatio: mean(pressure.map((point) => point.avgHpRatio)),
    maxDamageShare: Math.max(0, ...players.map((row) => safeRatio(row.damageTaken, totalDamage)))
  };
}

export function coopOverview(runs) {
  const coop = runs.filter((run) => run.isMultiplayer);
  const solo = runs.filter((run) => !run.isMultiplayer && run.status !== 'abandoned');
  const completedCoop = coop.filter((run) => run.status !== 'abandoned');
  const teamRuns = completedCoop.map(teamRunSummary);
  return {
    runs: coop.length,
    completed: completedCoop.length,
    winRate: safeRatio(completedCoop.filter((run) => run.win).length, completedCoop.length),
    soloWinRate: safeRatio(solo.filter((run) => run.win).length, solo.length),
    avgTeamDamage: mean(teamRuns.map((row) => row.totalDamage)),
    avgSimultaneousLowHp: mean(teamRuns.map((row) => row.simultaneousLowHpNodes)),
    avgDamageConcentration: mean(teamRuns.map((row) => row.maxDamageShare)),
    playerCounts: playerCountStats(coop),
    compositions: teamCompositionStats(coop),
    teammates: teammateStats(coop)
  };
}

export function coopPressureProfile(runs) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.isMultiplayer && item.status !== 'abandoned')) {
    const team = teamRunSummary(run);
    for (const point of team.pressure) {
      const key = `${point.act}:${point.actFloor}`;
      if (!groups.has(key)) groups.set(key, { act: point.act, actFloor: point.actFloor, floor: point.floor, samples: 0, teamDamage: [], avgHpRatio: [], lowPlayers: [], runIds: new Set() });
      const row = groups.get(key);
      row.samples += 1;
      row.runIds.add(String(run.id));
      row.teamDamage.push(point.teamDamage);
      row.avgHpRatio.push(point.avgHpRatio);
      row.lowPlayers.push(point.lowPlayers);
    }
  }
  return [...groups.values()].map((row) => ({
    act: row.act,
    actFloor: row.actFloor,
    absoluteFloor: row.floor,
    samples: row.samples,
    avgTeamDamage: mean(row.teamDamage),
    avgHpRatio: mean(row.avgHpRatio),
    avgLowPlayers: mean(row.lowPlayers),
    runIds: [...row.runIds]
  })).sort((a, b) => a.act - b.act || a.actFloor - b.actFloor);
}

export function coopPlayerPositionProfile(runs) {
  const groups = new Map();
  for (const run of runs.filter((item) => item.isMultiplayer && item.status !== 'abandoned')) {
    (run.players || []).forEach((_, index) => {
      if (!groups.has(index)) groups.set(index, []);
      groups.get(index).push(playerRunMetrics(run, index));
    });
  }
  return [...groups.entries()].map(([index, metrics]) => ({
    playerIndex: index,
    label: `P${index + 1}`,
    samples: metrics.length,
    damagePerCombat: mean(metrics.map((row) => row.damagePerCombat)),
    lowHpShare: mean(metrics.map((row) => row.lowHpShare)),
    goldSpendRate: mean(metrics.map((row) => row.goldSpendRate)),
    upgradeDensity: mean(metrics.map((row) => row.upgradeDensity)),
    deckSize: mean(metrics.map((row) => row.deckSize))
  })).sort((a, b) => a.playerIndex - b.playerIndex);
}

export function quantSignals(runs) {
  if (!runs.length) return [];
  const signals = [];
  const trend = performanceTrend(runs, 20);
  if (trend.recent.runs >= 8 && trend.baseline.runs >= 8) {
    const delta = trend.recent.winRate - trend.baseline.winRate;
    signals.push({ tone: delta >= .08 ? 'positive' : delta <= -.08 ? 'negative' : 'info', title: delta >= .08 ? '近期状态提升' : delta <= -.08 ? '近期状态回落' : '近期状态稳定', detail: `最近 ${trend.recent.runs} 局已完成游戏胜率 ${(trend.recent.winRate * 100).toFixed(0)}%，历史基线为 ${(trend.baseline.winRate * 100).toFixed(0)}%。` });
  }
  const resource = resourceProfile(runs);
  signals.push({ tone: resource.lowHpShare >= .28 ? 'warning' : 'info', title: 'HP 压力画像', detail: `${(resource.lowHpShare * 100).toFixed(0)}% 的已记录节点结束时 HP 不高于 35%；平均每场战斗承伤 ${resource.damagePerCombat.toFixed(1)}。` });
  signals.push({ tone: 'info', title: '选牌倾向', detail: `你跳过 ${(resource.cardSkipRate * 100).toFixed(0)}% 的已记录卡牌奖励；最终牌组平均升级密度为 ${(resource.upgradeDensity * 100).toFixed(0)}%。` });
  const coop = coopOverview(runs);
  if (coop.completed >= 5 && runs.some((run) => !run.isMultiplayer)) {
    const delta = coop.winRate - coop.soloWinRate;
    signals.push({ tone: delta >= .08 ? 'positive' : delta <= -.08 ? 'warning' : 'info', title: '多人合作改变了结果画像', detail: `多人合作胜率 ${(coop.winRate * 100).toFixed(0)}%，单人胜率 ${(coop.soloWinRate * 100).toFixed(0)}%（${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} 个百分点）。` });
  }
  return signals.slice(0, 5);
}
