import type { NormalizedRunV2, TimelinePoint } from './types';
import { buildPlayerTimeline, flattenMapHistory } from './parser';
import { zhFromTable } from './i18n';

type Sample = {
  choices: string[];
  hp: number | null;
  hpPercent: number | null;
  interval: 'complete' | 'censored' | 'incomplete';
  route: Set<string>;
};

const ROUTES = [
  ['shop', 'LEGEND_MERCHANT.hoverTip.title', '商店'],
  ['elite', 'LEGEND_ELITE.title', '精英'],
  ['monster', 'LEGEND_ENEMY.title', '敌人'],
  ['event', 'EVENT.title', '事件'],
  ['boss', 'LEGEND_BOSS.title', 'Boss'],
  ['treasure', 'LEGEND_TREASURE.title', '宝箱'],
  ['ancient', 'LEGEND_ANCIENT.title', '先古之民']
];

function nodeType(value: unknown): string {
  const id = String(value ?? '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return ({ rest_site: 'rest', restsite: 'rest', merchant: 'shop', enemy: 'monster', combat: 'monster', treasure_room: 'treasure' } as Record<string, string>)[id] || id;
}

function choiceID(value: unknown): string {
  const id = String(value ?? '').trim().toUpperCase().replace(/^REST_SITE_CHOICE\./, '').replace(/^OPTION_/, '').replace(/\.NAME$/, '');
  return ({ REST: 'HEAL', TRAIN: 'LIFT' } as Record<string, string>)[id] || id;
}

function isRest(point: TimelinePoint): boolean {
  return nodeType(point.type) === 'rest' || (point.restChoices?.length ?? 0) > 0;
}

function consecutive(previous: TimelinePoint, current: TimelinePoint): boolean {
  if (current.floor !== previous.floor + 1) return false;
  if (current.act === previous.act) return current.actFloor === previous.actFloor + 1;
  return current.act === previous.act + 1 && current.actFloor === 1;
}

function recorded(point: TimelinePoint | undefined, field: 'hp' | 'maxHp'): number | null {
  const value = point?.[field];
  return point?.recordedFields?.includes(field) && typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function rate(count: number, total: number): number | null { return total ? count / total : null; }
function mean(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

// Pearson's r with a binary action indicator is the point-biserial coefficient;
// with two binary indicators it is phi. Undefined variance stays missing.
function correlation(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  const mx = mean(pairs.map(pair => pair[0]))!;
  const my = mean(pairs.map(pair => pair[1]))!;
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of pairs) { xx += (x - mx) ** 2; yy += (y - my) ** 2; xy += (x - mx) * (y - my); }
  return xx > 0 && yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
}

function timelineFor(run: NormalizedRunV2): { points: TimelinePoint[]; map: any[] } {
  const stored = run.timeline || [];
  const rawMap = Array.isArray(run.map) && run.map.length ? run.map : flattenMapHistory((run.raw?.map_point_history || []) as any[]).flat;
  // Older dataset.json files may predate recordedFields. Rebuild only from the
  // original local telemetry, never treat their normalized zero defaults as data.
  const rebuild = rawMap.length && (!stored.length || stored.some(point => !Array.isArray(point.recordedFields)));
  if (!rawMap.length) return { points: stored, map: [] };
  const reconstructed = buildPlayerTimeline({ ...run, map: rawMap }, 0);
  if (rebuild) return { points: reconstructed, map: rawMap };
  const key = (point: TimelinePoint) => `${point.act}:${point.actFloor}:${point.floor}`;
  const byLocation = new Map(reconstructed.map((point: TimelinePoint, index: number) => [key(point), rawMap[index]]));
  return { points: stored, map: stored.map(point => byLocation.get(key(point))) };
}

function actualTypes(point: TimelinePoint, rawPoint: any): Set<string> {
  const rooms = Array.isArray(rawPoint?.rooms) ? rawPoint.rooms : [rawPoint?.room || rawPoint?.combat];
  const roomTypes = rooms.map((room: any) => nodeType(room?.room_type)).filter((type: string) => ROUTES.some(([id]) => id === type) || type === 'rest');
  // A question-mark map node can actually contain a shop or combat. Prefer its
  // recorded room type; an event followed by combat can contain both room types.
  const mapType = nodeType(point.type);
  // Some builds serialize every fight's room as "monster". The map still
  // records elite/boss identity and must not be downgraded to ordinary combat.
  if (mapType === 'elite' || mapType === 'boss') {
    return new Set([mapType, ...roomTypes.filter((type: string) => type !== 'monster')]);
  }
  return new Set(roomTypes.length ? roomTypes : [mapType]);
}

/** Descriptive, local-only analysis of already-filtered solo runs. */
export function analyzeRestSites(runs: NormalizedRunV2[]) {
  const samples: Sample[] = [];
  const occurrences = new Map<string, number>();
  let runCount = 0;
  for (const run of runs) {
    const { points, map } = timelineFor(run);
    const restIndices = points.map((point, index) => isRest(point) || actualTypes(point, map[index]).has('rest') ? index : -1).filter(index => index >= 0);
    if (restIndices.length) runCount += 1;
    restIndices.forEach((index, position) => {
      const point = points[index], previous = points[index - 1];
      const rawChoices = (point.restChoices || []).map(choiceID).filter(Boolean);
      for (const id of rawChoices) occurrences.set(id, (occurrences.get(id) || 0) + 1);
      const choices = [...new Set(rawChoices)];
      const canUsePrevious = previous && previous.act === point.act && consecutive(previous, point);
      const hp = canUsePrevious ? recorded(previous, 'hp') : null;
      const maxHp = canUsePrevious ? recorded(previous, 'maxHp') : null;
      const hpPercent = hp !== null && maxHp !== null && maxHp > 0 && hp <= maxHp ? hp / maxHp : null;
      const next = restIndices[position + 1];
      let interval: Sample['interval'] = next === undefined ? 'censored' : 'complete';
      const route = new Set<string>();
      if (next !== undefined) {
        for (let cursor = index + 1; cursor <= next; cursor += 1) {
          if (!consecutive(points[cursor - 1], points[cursor])) interval = 'incomplete';
          if (cursor === next) continue;
          const types = actualTypes(points[cursor], map[cursor]);
          if (![...types].every(type => ROUTES.some(([id]) => id === type))) interval = 'incomplete';
          for (const type of types) route.add(type);
        }
      }
      samples.push({ choices, hp, hpPercent, interval, route });
    });
  }
  const observed = samples.filter(sample => sample.choices.length);
  const ids = [...occurrences.keys()].sort((a, b) => occurrences.get(b)! - occurrences.get(a)! || a.localeCompare(b));
  const hpSamples = observed.filter(sample => sample.hp !== null);
  const percentSamples = observed.filter(sample => sample.hpPercent !== null);
  const complete = observed.filter(sample => sample.interval === 'complete');
  function bins(field: 'hp' | 'hpPercent', edges: number[], labels: string[]) {
    return edges.map((min, index) => {
      const max = edges[index + 1] ?? null;
      const group = observed.filter(sample => sample[field] !== null && sample[field]! >= min && (max === null || sample[field]! < max));
      return { id: `${field}-${index}`, label: labels[index], min, max, sample: group.length,
        choices: ids.map(id => { const count = group.filter(sample => sample.choices.includes(id)).length; return { id, count, rate: rate(count, group.length) }; }) };
    });
  }
  return {
    runCount, siteCount: samples.length, recordedChoiceSites: observed.length,
    multiChoiceSites: observed.filter(sample => sample.choices.length > 1).length,
    hpSamples: hpSamples.length, hpPercentSamples: percentSamples.length,
    completeIntervals: complete.length,
    censoredIntervals: observed.filter(sample => sample.interval === 'censored').length,
    incompleteIntervals: observed.filter(sample => sample.interval === 'incomplete').length,
    choices: ids.map(id => {
      const selected = observed.filter(sample => sample.choices.includes(id));
      const hps = selected.flatMap(sample => sample.hp === null ? [] : [sample.hp]);
      const percents = selected.flatMap(sample => sample.hpPercent === null ? [] : [sample.hpPercent]);
      return { id, name: zhFromTable('rest_site_ui', `OPTION_${id}.name`, id), count: occurrences.get(id)!, siteCount: selected.length,
        siteRate: rate(selected.length, observed.length), hpSamples: hps.length, hpPercentSamples: percents.length,
        meanHp: mean(hps), meanHpPercent: mean(percents),
        hpCorrelation: correlation(hpSamples.map(sample => [sample.hp!, Number(sample.choices.includes(id))])),
        hpPercentCorrelation: correlation(percentSamples.map(sample => [sample.hpPercent!, Number(sample.choices.includes(id))])) };
    }),
    hpBins: bins('hp', [0, 20, 40, 60, 80, 100], ['0–19', '20–39', '40–59', '60–79', '80–99', '100+']),
    hpPercentBins: bins('hpPercent', [0, .2, .4, .6, .8], ['0–<20%', '20–<40%', '40–<60%', '60–<80%', '80–100%']),
    routes: ROUTES.map(([id, key, fallback]) => {
      const present = complete.filter(sample => sample.route.has(id)), absent = complete.filter(sample => !sample.route.has(id));
      return { id, name: zhFromTable('map', key, fallback), presentSamples: present.length, absentSamples: absent.length,
        choices: ids.map(choice => {
          const presentCount = present.filter(sample => sample.choices.includes(choice)).length;
          const absentCount = absent.filter(sample => sample.choices.includes(choice)).length;
          const presentRate = rate(presentCount, present.length), absentRate = rate(absentCount, absent.length);
          return { id: choice, presentCount, absentCount, presentRate, absentRate,
            rateDifference: presentRate !== null && absentRate !== null ? presentRate - absentRate : null,
            phi: correlation(complete.map(sample => [Number(sample.route.has(id)), Number(sample.choices.includes(choice))])) };
        }) };
    }),
    notes: [
      '生命值取同阶段紧邻上一节点的已记录快照，作为进入休息处前的代理；不是火堆操作后的生命，也无法识别进入时自动触发的回复。首节点、跨阶段和缺失记录不补零。',
      '选择率以记录过选择的休息处节点为分母；同一节点可选择多个动作，同动作去重后计入选择率，因此各动作比例之和可能超过100%。动作次数保留重复记录。',
      '路线仅统计当前休息处之后、下一实际休息处之前的已走节点，不包含两端；允许跨阶段。没有下一休息处的区间单列为截尾，缺口或无法识别房间的区间排除。',
      '路线样本数只含有记录选择的休息处。各类房间可同时出现；按实际房间类型识别未知地图节点中的商店或敌人。',
      '生命相关系数为点二列相关，路线系数为φ；正值表示指标较高或路线有该房间时更常选择该动作。缺少两组或无方差时不计算。',
      '仅为已走路线与选择的描述性相关，不代表因果或事前计划；未记录的可用选项和未走路线无法比较。角色、进阶、遗物及同一对局内重复决策均可能影响结果，未作调整或显著性检验。'
    ]
  };
}
