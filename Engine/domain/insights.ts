import type { CareerProgress, DataItemRef, NormalizedRunV2 } from './types.js';
import { performanceTrend, playerRunMetrics } from './quant.js';
import { zhCharacter, zhEntity } from './i18n.js';

export type InsightCategory = 'strength' | 'observation' | 'pattern' | 'milestone' | 'trend';

export type CuratedInsight = {
  id: string;
  category: InsightCategory;
  title: string;
  detail: string;
  value?: string;
  score: number;
  items?: DataItemRef[];
  comparison?: Array<{ label: string; value: number; sample: number }>;
};

export type PlayerBadge = { id: string; label: string; detail: string };

export type PlayerInsightProfile = {
  title: string;
  subtitle: string;
  badges: PlayerBadge[];
  insights: CuratedInsight[];
  summary: { completed: number; winRate: number; bestStreak: number; totalPlaytime: number; highestAscensionWin: number };
};

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function mean(values: number[]) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function median(values: number[]) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function bestStreak(runs: NormalizedRunV2[]) {
  let current = 0;
  let best = 0;
  for (const run of [...runs].sort((a, b) => a.startTime - b.startTime)) {
    current = run.win ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function compareGroups<T>(rows: T[], groupA: (row: T) => boolean, groupB: (row: T) => boolean, outcome: (row: T) => boolean, min = 3) {
  const a = rows.filter(groupA);
  const b = rows.filter(groupB);
  if (a.length < min || b.length < min) return null;
  const aRate = ratio(a.filter(outcome).length, a.length);
  const bRate = ratio(b.filter(outcome).length, b.length);
  return { a, b, aRate, bRate, delta: Math.abs(aRate - bRate) };
}

function playerTitle(completed: NormalizedRunV2[], winRate: number, streak: number, highestAscensionWin: number) {
  const characterCounts = new Map<string, number>();
  completed.forEach((run) => characterCounts.set(run.character, (characterCounts.get(run.character) || 0) + 1));
  const dominant = [...characterCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const coopShare = ratio(completed.filter((run) => run.isMultiplayer).length, completed.length);
  if (completed.length >= 100 && streak >= 5) return { title: '尖塔老兵', subtitle: `${completed.length} 局已完成游戏，最长 ${streak} 连胜。` };
  if (highestAscensionWin >= 10 && winRate >= .5) return { title: '高阶征服者', subtitle: `已在 A${highestAscensionWin} 获胜，整体胜率 ${pct(winRate)}。` };
  if (coopShare >= .6 && completed.length >= 10) return { title: '协作指挥官', subtitle: `${pct(coopShare)} 的已完成游戏来自多人合作。` };
  if (dominant && ratio(dominant[1], completed.length) >= .6 && completed.length >= 8) return { title: `${zhCharacter(dominant[0])}专精者`, subtitle: `${pct(ratio(dominant[1], completed.length))} 的游戏使用该角色。` };
  if (completed.length >= 25) return { title: '稳定攀登者', subtitle: `${completed.length} 局样本已经足以形成个人长期画像。` };
  return { title: '尖塔观察者', subtitle: '继续积累对局后，称号和洞察会随唯一存档自动更新。' };
}

function buildBadges(completed: NormalizedRunV2[], streak: number): PlayerBadge[] {
  const badges: PlayerBadge[] = [];
  if (!completed.length) return badges;
  const metrics = completed.map((run) => playerRunMetrics(run));
  const avgDeck = mean(completed.map((run) => run.deckSize));
  const avgElites = mean(metrics.map((row) => Number(row.elites || 0)));
  const smiths = metrics.reduce((sum, row) => sum + Number(row.smithCount || 0), 0);
  const heals = metrics.reduce((sum, row) => sum + Number(row.healRestCount || 0), 0);
  const characterCounts = new Map<string, number>();
  completed.forEach((run) => characterCounts.set(run.character, (characterCounts.get(run.character) || 0) + 1));
  const dominant = [...characterCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (avgDeck > 0 && avgDeck < 18) badges.push({ id: 'minimalist', label: '精简牌组', detail: `平均最终牌组 ${avgDeck.toFixed(1)} 张。` });
  if (avgDeck >= 28) badges.push({ id: 'collector', label: '牌组收藏家', detail: `平均最终牌组 ${avgDeck.toFixed(1)} 张。` });
  if (avgElites >= 4) badges.push({ id: 'elite-hunter', label: '精英猎手', detail: `平均每局挑战 ${avgElites.toFixed(1)} 个精英节点。` });
  if (avgElites > 0 && avgElites < 1.5) badges.push({ id: 'elite-cautious', label: '谨慎路线', detail: `平均每局仅经过 ${avgElites.toFixed(1)} 个精英节点。` });
  if (smiths + heals >= 8 && ratio(smiths, smiths + heals) > .6) badges.push({ id: 'smith', label: '锻造派', detail: `${pct(ratio(smiths, smiths + heals))} 的休息处核心选择偏向锻造。` });
  if (smiths + heals >= 8 && ratio(heals, smiths + heals) > .6) badges.push({ id: 'rest', label: '休整派', detail: `${pct(ratio(heals, smiths + heals))} 的休息处核心选择偏向恢复。` });
  if (dominant && ratio(dominant[1], completed.length) >= .6 && completed.length >= 8) badges.push({ id: 'main', label: `${zhCharacter(dominant[0])}主力`, detail: `${dominant[1]} / ${completed.length} 局使用该角色。` });
  if ([...characterCounts.values()].filter((count) => count >= 2).length >= 4) badges.push({ id: 'explorer', label: '全角色探索', detail: '至少四个角色拥有两局以上的已完成记录。' });
  if (streak >= 3) badges.push({ id: 'streak', label: `${streak} 连胜`, detail: '当前存档中的最佳连续胜利。' });
  if (mean(completed.map((run) => run.runTime)) >= 2700) badges.push({ id: 'marathon', label: '长线思考', detail: '平均每局耗时超过 45 分钟。' });
  return badges.slice(0, 8);
}

export function buildPlayerInsightProfile(runs: NormalizedRunV2[], progress: CareerProgress | null = null): PlayerInsightProfile {
  const completed = runs.filter((run) => run.status !== 'abandoned');
  const wins = completed.filter((run) => run.win);
  const winRate = ratio(wins.length, completed.length);
  const streak = bestStreak(completed);
  const totalPlaytime = Number(progress?.totalPlaytime || 0) || runs.reduce((sum, run) => sum + Number(run.runTime || 0), 0);
  const highestAscensionWin = Math.max(0, ...wins.map((run) => Number(run.ascension) || 0));
  const identity = playerTitle(completed, winRate, streak, highestAscensionWin);
  const insights: CuratedInsight[] = [];

  const trend = performanceTrend(completed, Math.min(20, Math.max(8, Math.floor(completed.length / 3))));
  if (trend.recent.runs >= 8 && trend.baseline.runs >= 8) {
    const delta = trend.recent.winRate - trend.baseline.winRate;
    insights.push({
      id: 'recent-trend', category: 'trend', score: 80 + Math.abs(delta) * 100,
      title: delta >= .08 ? '近期状态正在提升' : delta <= -.08 ? '近期结果有所回落' : '近期表现保持稳定',
      detail: `近期 ${trend.recent.runs} 局胜率 ${pct(trend.recent.winRate)}，长期基线 ${pct(trend.baseline.winRate)}。`,
      value: `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} 个百分点`
    });
  }

  const characterRows = [...new Set(completed.map((run) => run.character))].map((character) => {
    const rows = completed.filter((run) => run.character === character);
    return { character, rows, rate: ratio(rows.filter((run) => run.win).length, rows.length) };
  }).filter((row) => row.rows.length >= 3).sort((a, b) => b.rate - a.rate);
  if (characterRows.length >= 2) {
    const strongest = characterRows[0];
    const toughest = characterRows.at(-1)!;
    if (strongest.rate - toughest.rate >= .1) insights.push({
      id: 'character-gap', category: 'observation', score: 74 + (strongest.rate - toughest.rate) * 60,
      title: '角色结果差异明显',
      detail: `${zhCharacter(strongest.character)}胜率 ${pct(strongest.rate)}，${zhCharacter(toughest.character)}为 ${pct(toughest.rate)}。`,
      value: `${Math.round((strongest.rate - toughest.rate) * 100)} 个百分点`,
      items: [{ kind: 'character', id: toughest.character }]
    });
  }

  const metrics = completed.map((run) => ({ run, metrics: playerRunMetrics(run) }));
  const actOneRows = metrics.map(({ run, metrics: row }) => ({ run, damage: (row.timeline || []).filter((point: { act?: number }) => Number(point.act) === 1).reduce((sum: number, point: { damageTaken?: number }) => sum + Number(point.damageTaken || 0), 0) }));
  const actOneMedian = median(actOneRows.map((row) => row.damage));
  const actOne = compareGroups(actOneRows, (row) => row.damage <= actOneMedian, (row) => row.damage > actOneMedian, (row) => row.run.win, 4);
  if (actOne && actOne.delta >= .1) insights.push({
    id: 'act-one-damage', category: 'pattern', score: 78 + actOne.delta * 80,
    title: '第一阶段承伤与结果相关',
    detail: `第一阶段承伤不高于 ${Math.round(actOneMedian)} 时胜率 ${pct(actOne.aRate)}，更高时为 ${pct(actOne.bRate)}。`,
    comparison: [{ label: `≤ ${Math.round(actOneMedian)} 承伤`, value: actOne.aRate, sample: actOne.a.length }, { label: `> ${Math.round(actOneMedian)} 承伤`, value: actOne.bRate, sample: actOne.b.length }]
  });

  const deckGroups = [
    { label: '≤17 张', rows: completed.filter((run) => run.deckSize <= 17) },
    { label: '18–24 张', rows: completed.filter((run) => run.deckSize >= 18 && run.deckSize <= 24) },
    { label: '≥25 张', rows: completed.filter((run) => run.deckSize >= 25) }
  ].filter((group) => group.rows.length >= 3).map((group) => ({ ...group, rate: ratio(group.rows.filter((run) => run.win).length, group.rows.length) }));
  if (deckGroups.length >= 2) {
    const sorted = [...deckGroups].sort((a, b) => b.rate - a.rate);
    if (sorted[0].rate - sorted.at(-1)!.rate >= .1) insights.push({
      id: 'deck-size', category: 'pattern', score: 70 + (sorted[0].rate - sorted.at(-1)!.rate) * 70,
      title: '牌组规模存在个人甜点区',
      detail: `${sorted[0].label}的胜率最高，为 ${pct(sorted[0].rate)}。`,
      comparison: deckGroups.map((group) => ({ label: group.label, value: group.rate, sample: group.rows.length }))
    });
  }

  const eliteRows = metrics.map(({ run, metrics: row }) => ({ run, elites: Number(row.elites || 0) }));
  const eliteMedian = median(eliteRows.map((row) => row.elites));
  const elites = compareGroups(eliteRows, (row) => row.elites <= eliteMedian, (row) => row.elites > eliteMedian, (row) => row.run.win, 4);
  if (elites && elites.delta >= .1) insights.push({
    id: 'elite-risk', category: 'pattern', score: 68 + elites.delta * 70,
    title: '精英路线改变了结果画像',
    detail: `${elites.aRate >= elites.bRate ? '较少挑战精英' : '更积极挑战精英'}的游戏在当前样本中胜率更高。`,
    comparison: [{ label: `≤ ${eliteMedian} 个精英`, value: elites.aRate, sample: elites.a.length }, { label: `> ${eliteMedian} 个精英`, value: elites.bRate, sample: elites.b.length }]
  });

  const restRows = metrics.map(({ run, metrics: row }) => ({ run, smith: Number(row.smithCount || 0), heal: Number(row.healRestCount || 0) })).filter((row) => row.smith !== row.heal);
  const rests = compareGroups(restRows, (row) => row.smith > row.heal, (row) => row.heal > row.smith, (row) => row.run.win, 3);
  if (rests && rests.delta >= .1) insights.push({
    id: 'rest-choice', category: 'pattern', score: 71 + rests.delta * 70,
    title: '休息处选择形成稳定差异',
    detail: `${rests.aRate >= rests.bRate ? '锻造偏多' : '恢复偏多'}的游戏胜率更高。`,
    comparison: [{ label: '锻造偏多', value: rests.aRate, sample: rests.a.length }, { label: '恢复偏多', value: rests.bRate, sample: rests.b.length }]
  });

  const finalGold = metrics.map(({ run, metrics: row }) => ({ run, gold: Number(row.timeline?.at(-1)?.gold ?? run.gold ?? 0) }));
  const lossesGold = finalGold.filter((row) => !row.run.win);
  const winsGold = finalGold.filter((row) => row.run.win);
  if (lossesGold.length >= 3 && winsGold.length >= 3) {
    const lossGold = mean(lossesGold.map((row) => row.gold));
    const winGold = mean(winsGold.map((row) => row.gold));
    if (lossGold - winGold >= 50) insights.push({
      id: 'unspent-gold', category: 'observation', score: 69 + Math.min(30, (lossGold - winGold) / 10),
      title: '失败局保留了较多金币',
      detail: `失败局结束时平均保留 ${Math.round(lossGold)} 金币，胜利局为 ${Math.round(winGold)}。`,
      value: `多留 ${Math.round(lossGold - winGold)} 金币`
    });
  }

  const lowHpShare = mean(metrics.map(({ metrics: row }) => Number(row.lowHpShare || 0)));
  if (completed.length >= 5) insights.push({
    id: 'hp-pressure', category: lowHpShare <= .12 ? 'strength' : 'observation', score: 62 + Math.abs(lowHpShare - .2) * 60,
    title: lowHpShare <= .12 ? '低血量暴露控制良好' : lowHpShare >= .28 ? '低血量区间偏多' : '生命压力处于中等水平',
    detail: `${pct(lowHpShare)} 的已记录节点结束时 HP 不高于 35%。`,
    value: pct(lowHpShare)
  });

  const encounterRows = new Map<string, { fights: number; damage: number; deaths: number }>();
  for (const run of completed) for (const event of run.encounterEvents || []) {
    const row = encounterRows.get(event.id) || { fights: 0, damage: 0, deaths: 0 };
    row.fights += 1;
    row.damage += Number(event.damageTaken || 0);
    if (event.killedPlayer) row.deaths += 1;
    encounterRows.set(event.id, row);
  }
  const nemesis = [...encounterRows.entries()].filter(([, row]) => row.fights >= 3).sort((a, b) => (b[1].deaths * 100 + b[1].damage / b[1].fights) - (a[1].deaths * 100 + a[1].damage / a[1].fights))[0];
  if (nemesis) insights.push({
    id: 'nemesis', category: 'observation', score: 66 + nemesis[1].deaths * 8,
    title: '最需要关注的遭遇战',
    detail: `${zhEntity(nemesis[0], 'encounters', nemesis[0])}共遭遇 ${nemesis[1].fights} 次，平均承伤 ${mean([nemesis[1].damage / nemesis[1].fights]).toFixed(1)}。`,
    value: `${nemesis[1].deaths} 次致死`,
    items: [{ kind: 'encounter', id: nemesis[0] }]
  });

  const runMilestone = [250, 100, 50, 25, 10].find((threshold) => completed.length >= threshold);
  if (runMilestone) insights.push({ id: `runs-${runMilestone}`, category: 'milestone', score: 60 + Math.log2(completed.length + 1) * 4, title: '游戏局数里程碑', detail: `当前唯一存档包含 ${completed.length} 局已完成游戏。`, value: `${completed.length} 局` });
  if (streak >= 3) insights.push({ id: 'best-streak', category: 'milestone', score: 64 + streak * 3, title: '连胜里程碑', detail: `最佳连续胜利达到 ${streak} 局。`, value: `${streak} 连胜` });
  if (wins.length) {
    const fastest = [...wins].sort((a, b) => a.runTime - b.runTime)[0];
    insights.push({ id: 'fastest-win', category: 'milestone', score: 58, title: '最快胜利', detail: `${zhCharacter(fastest.character)}在 A${fastest.ascension} 完成了当前存档中最快的胜利。`, value: `${Math.floor(fastest.runTime / 60)} 分钟`, items: [{ kind: 'run', id: fastest.id }] });
    const peak = [...wins].sort((a, b) => b.ascension - a.ascension)[0];
    if (peak.ascension > 0) insights.push({ id: 'highest-ascension', category: 'milestone', score: 59 + peak.ascension, title: '最高进阶胜利', detail: `${zhCharacter(peak.character)}完成了 A${peak.ascension}。`, value: `A${peak.ascension}`, items: [{ kind: 'ascension', id: String(peak.ascension) }] });
    const closest = wins.filter((run) => run.finalHp > 0).sort((a, b) => a.finalHp - b.finalHp)[0];
    if (closest && closest.finalHp <= 5) insights.push({ id: 'closest-call', category: 'milestone', score: 72 + (6 - closest.finalHp) * 3, title: '绝境生还', detail: `一局胜利结束时仅剩 ${closest.finalHp} HP。`, value: `${closest.finalHp} HP`, items: [{ kind: 'run', id: closest.id }] });
  }

  return {
    ...identity,
    badges: buildBadges(completed, streak),
    insights: insights.sort((a, b) => b.score - a.score).slice(0, 14),
    summary: { completed: completed.length, winRate, bestStreak: streak, totalPlaytime, highestAscensionWin }
  };
}
