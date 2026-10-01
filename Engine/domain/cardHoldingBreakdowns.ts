import { normalizeCard } from './parser.js';
import { wilsonInterval } from './quant.js';
import type { NormalizedCard, NormalizedRunV2 } from './types.js';
import type { ObjectBreakdown, ObjectTableColumn, ObjectTableRow } from './objectTypes.js';

const columns: ObjectTableColumn[] = [
  { id: 'runs', label: '局数', format: 'number', help: '最终持有该牌的独立单人对局数，包含放弃；同局仅计一次。' },
  { id: 'completedRuns', label: '完成局数', format: 'number', help: '排除放弃后的独立对局数，也是胜率分母。' },
  { id: 'wins', label: '胜利局数', format: 'number' },
  { id: 'winRate', label: '胜率', format: 'percent', help: '胜利局数 ÷ 完成局数；没有完成样本时留空。' },
  { id: 'winRateInterval', label: '95%区间', format: 'text', help: '独立完成对局胜率的 95% Wilson 置信区间。' }
];
const commonHelp = '仅统计最终快照持有该牌的独立单人对局，每局一票；放弃计入局数，但不进入胜率分母。95% 区间使用 Wilson 方法。这些分组表示关联，不代表数量或升级导致胜率变化；角色、进阶、牌组构成和存活时长等都可能影响结果。';
const shareBins = [
  { id: '0', label: '0%', low: 0, high: 0 },
  { id: '0-25', label: '(0%, 25%]', low: 0, high: 0.25 },
  { id: '25-50', label: '(25%, 50%]', low: 0.25, high: 0.5 },
  { id: '50-75', label: '(50%, 75%]', low: 0.5, high: 0.75 },
  { id: '75-100', label: '(75%, 100%]', low: 0.75, high: 1 }
];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Older datasets replaced absent levels with zero. Recover recorded levels from
// raw snapshots where possible; never reinterpret an ambiguous legacy zero.
function knownDeck(run: NormalizedRunV2, deck: NormalizedCard[]): Array<number | null> {
  const raw = record(run.raw);
  const player = record((Array.isArray(raw.players) ? raw.players[0] : undefined) ?? raw.player);
  const rawDeck = player.deck ?? player.master_deck ?? player.cards;
  const restored: NormalizedCard[] = Array.isArray(rawDeck) ? rawDeck.map(normalizeCard).filter((card): card is NonNullable<typeof card> => card !== null) : [];
  const matches = restored.length === deck.length && restored.every((card, index) => card.id === deck[index].id);
  return deck.map((card, index) => {
    if (card.upgradeKnown === false) return null;
    if (card.upgradeKnown === true) return Number.isInteger(card.upgradeLevel) && card.upgradeLevel >= 0 ? card.upgradeLevel : null;
    if (matches) return restored[index].upgradeKnown ? restored[index].upgradeLevel : null;
    if (rawDeck !== undefined && rawDeck !== null) return null;
    return Number.isInteger(card.upgradeLevel) && card.upgradeLevel > 0 ? card.upgradeLevel : null;
  });
}

function row(id: string, label: string, runs: NormalizedRunV2[], extra: ObjectTableRow['values'] = {}): ObjectTableRow {
  const completed = runs.filter((run) => run.status !== 'abandoned');
  const wins = completed.filter((run) => run.win).length;
  const interval = completed.length ? wilsonInterval(wins, completed.length) : null;
  return { id, label, values: {
    ...extra, runs: runs.length, completedRuns: completed.length, wins,
    winRate: completed.length ? wins / completed.length : null,
    winRateInterval: interval ? `${(interval.low * 100).toFixed(1)}%–${(interval.high * 100).toFixed(1)}%` : null
  } };
}

export function cardHoldingBreakdowns(cardId: string, runs: NormalizedRunV2[]): ObjectBreakdown[] {
  const counts = new Map<number, NormalizedRunV2[]>();
  const upgrades = new Map<number, Map<string, NormalizedRunV2[]>>();
  const shares = shareBins.map(() => [] as NormalizedRunV2[]);
  let unknownCardRuns = 0, unknownDeckRuns = 0;
  for (const run of new Map(runs.map((run) => [run.id, run])).values()) {
    const deck = run.players?.[0]?.deck ?? run.deck;
    const indices = deck.flatMap((card, index) => card.id === cardId ? [index] : []);
    const copies = indices.length;
    if (!copies) continue;
    const group = counts.get(copies) || []; group.push(run); counts.set(copies, group);
    const levels = knownDeck(run, deck);
    if (indices.every((index) => levels[index] !== null)) {
      const upgraded = indices.filter((index) => levels[index]! > 0).length;
      const state = upgraded === 0 ? 'none' : upgraded === copies ? 'all' : 'partial';
      const states = upgrades.get(copies) || new Map<string, NormalizedRunV2[]>();
      const stateRuns = states.get(state) || []; stateRuns.push(run); states.set(state, stateRuns); upgrades.set(copies, states);
    } else { unknownCardRuns += 1; }
    if (levels.every((level) => level !== null)) {
      const share = levels.filter((level) => level! > 0).length / deck.length;
      const index = share === 0 ? 0 : shareBins.findIndex((bin) => share > bin.low && share <= bin.high);
      shares[index].push(run);
    } else { unknownDeckRuns += 1; }
  }
  const orderedCounts = [...counts.keys()].sort((a, b) => a - b);
  const states = [{ id: 'none', label: '未升级' }, { id: 'partial', label: '部分升级' }, { id: 'all', label: '全部升级' }];
  return [
    { id: 'cardCopyCount', label: '持有张数与胜率', help: `${commonHelp}按最终牌组中相同卡牌 ID 的精确张数分组，升级等级不影响张数；不包含未持有者。`, columns,
      rows: orderedCounts.map((copies) => row(String(copies), `${copies} 张`, counts.get(copies)!, { copies })) },
    { id: 'cardUpgradeState', label: '该牌升级与胜率', help: `${commonHelp}先按持有张数分组，再按该牌未升级、部分升级或全部升级分组；升级等级大于 0 即为已升级，不叠加多级升级次数。该牌任一副本升级状态未知则排除该局；本次排除 ${unknownCardRuns} 局。旧数据中无法核实的零级记录视为未知。`, columns,
      rows: orderedCounts.flatMap((copies) => states.flatMap((state) => {
        const group = upgrades.get(copies)?.get(state.id);
        return group ? [row(`${copies}:${state.id}`, `${copies} 张 · ${state.label}`, group, { copies })] : [];
      })) },
    { id: 'deckUpgradeShare', label: '牌组升级占比与胜率', help: `${commonHelp}占比为最终整副牌组中升级等级大于 0 的卡牌张数 ÷ 总张数，包含当前卡牌。固定分组为 0%、(0%, 25%]、(25%, 50%]、(50%, 75%]、(75%, 100%]。任一卡牌升级状态未知则排除该局；本次排除 ${unknownDeckRuns} 局。旧数据中无法核实的零级记录视为未知。`, columns,
      rows: shares.some((group) => group.length) ? shareBins.map((bin, index) => row(bin.id, bin.label, shares[index], { shareLow: bin.low, shareHigh: bin.high })) : [] }
  ];
}
