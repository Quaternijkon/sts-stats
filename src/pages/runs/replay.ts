import type {
  NormalizedCard,
  NormalizedRunV2,
  TimelinePoint,
} from "../../../Engine/domain/types";

export function recordedValue(point: TimelinePoint, field: string): number | null {
  const value = point[field];
  return point.recordedFields?.includes(field) &&
    typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

export function withHealthChanges(points: TimelinePoint[]): TimelinePoint[] {
  return points.map((point, index) => {
    const previous = points[index - 1];
    const hp = recordedValue(point, "hp");
    const before = previous ? recordedValue(previous, "hp") : null;
    if (hp == null || before == null || point.floor !== previous.floor + 1)
      return point;
    return {
      ...point,
      hpLoss: Math.max(0, before - hp),
      hpGain: Math.max(0, hp - before),
      recordedFields: [...new Set([...(point.recordedFields ?? []), "hpLoss", "hpGain"])],
    };
  });
}

export function recordedSegments(points: TimelinePoint[], field: string): number[][] {
  const segments: number[][] = [];
  let segment: number[] = [];
  points.forEach((point, index) => {
    if (recordedValue(point, field) == null) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    if (segment.length && point.floor !== points[index - 1].floor + 1) {
      segments.push(segment);
      segment = [];
    }
    segment.push(index);
  });
  if (segment.length) segments.push(segment);
  return segments;
}

export function groupedCards(cards: NormalizedCard[]) {
  const groups = new Map<string, { id: string; upgrade: number; count: number }>();
  for (const card of cards) {
    const upgrade = card.upgradeLevel ?? 0;
    const key = JSON.stringify([card.id, upgrade]);
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { id: card.id, upgrade, count: 1 });
  }
  return [...groups.values()];
}

export function groupedIds(ids: string[]) {
  const groups = new Map<string, number>();
  for (const id of ids) groups.set(id, (groups.get(id) ?? 0) + 1);
  return [...groups].map(([id, count]) => ({ id, count }));
}

export function isCoopRun(run: NormalizedRunV2): boolean {
  return run.isMultiplayer || run.playerCount > 1 || run.players.length > 1;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A parser's normalized zero is not evidence that the save recorded zero HP. */
export function finalHealth(run: NormalizedRunV2, playerIndex: number) {
  const last = run.timeline.at(-1);
  const player = run.players[playerIndex] ?? run.players[0];
  const rawPlayers = Array.isArray(run.raw.players) ? run.raw.players : [];
  const rawPlayer = rawPlayers.find((candidate) =>
    typeof candidate === "object" && candidate !== null &&
    (candidate as Record<string, unknown>).id === player?.id,
  ) ?? rawPlayers[playerIndex];
  const raw = typeof rawPlayer === "object" && rawPlayer !== null
    ? rawPlayer as Record<string, unknown>
    : {};
  return {
    hp: (last ? recordedValue(last, "hp") : null) ?? finite(raw.current_hp) ??
      (playerIndex === 0 ? finite(run.raw.current_hp) : null),
    maxHp: (last ? recordedValue(last, "maxHp") : null) ?? finite(raw.max_hp) ??
      (playerIndex === 0 ? finite(run.raw.max_hp) : null),
  };
}

export function recordedTotal(points: TimelinePoint[], field: string): number | null {
  const values = points.map((point) => recordedValue(point, field));
  return values.some((value) => value != null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
}

/** Monotone cubic segments pass through the records without overshooting them. */
export function curvePath(samples: { x: number; y: number }[]): string {
  if (!samples.length) return "";
  const start = `M${samples[0].x},${samples[0].y}`;
  if (samples.length === 1) return start;
  const slopes = samples.slice(1).map((point, index) =>
    (point.y - samples[index].y) / (point.x - samples[index].x),
  );
  const tangents = samples.map((_, index) => {
    if (!index) return slopes[0];
    if (index === samples.length - 1) return slopes.at(-1)!;
    const before = slopes[index - 1], after = slopes[index];
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  });
  return start + samples.slice(1).map((point, index) => {
    const previous = samples[index];
    const width = (point.x - previous.x) / 3;
    return ` C${previous.x + width},${previous.y + width * tangents[index]} ${point.x - width},${point.y - width * tangents[index + 1]} ${point.x},${point.y}`;
  }).join("");
}

export function rawExportName(fileName: string): string {
  const name = fileName.split(/[\\/]/).at(-1) || "run.run";
  return /\.json$/i.test(name) ? name : `${name}.json`;
}
