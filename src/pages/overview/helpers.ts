export interface ActivityDay {
  date: string;
  startTime: number;
  endTime: number;
}

export interface ActivityValue {
  date: string;
  seconds: number;
  runCount: number;
  percentile: number | null;
  level: number;
}

export interface RunSummary {
  total: number;
  completed: number;
  wins: number;
  losses: number;
  abandoned: number;
  winRate: number;
  avgFloor: number;
  avgTime: number;
  avgDeck: number;
  highestAscension: number;
  currentStreak: number;
  maxWinStreak: number;
  avgDamageTaken: number;
  minWinningDeckSize: number | null;
  maxWinningDeckSize: number | null;
}

export interface CharacterSummary extends RunSummary {
  character: string;
}

export interface OutcomeEntry {
  id: string;
  character: string;
  status: string;
  startTime: number;
  runTime: number;
  ascension: number;
}

export interface OutcomeGroup {
  id: string;
  total: number;
  wins: number;
  losses: number;
  abandoned: number;
  items: OutcomeEntry[];
}

export interface OverviewData {
  summary: RunSummary;
  characters?: CharacterSummary[];
  characterStats?: CharacterSummary[];
  rolling?: { index: number; value: number; timestamp: number }[];
  survival?: { floor: number; value: number }[];
  ascensions?: (RunSummary & { ascension: number })[];
  history?: { overall: OutcomeGroup; characters: OutcomeGroup[] };
  playtime?: {
    days: ActivityValue[];
    totalSeconds: number;
    activeDays: number;
    totalRuns: number;
    firstStartTime: number | null;
    lastStartTime: number | null;
  };
  totalPlaytime?: number;
  floorsClimbed?: number;
}

export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Calendar arithmetic keeps midnight boundaries correct across DST and leap years. */
export function activityDays(today: Date, year = 0): ActivityDay[] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  let last = end;
  if (year > 0) {
    start.setFullYear(year, 0, 1);
    last = new Date(Math.min(end.valueOf(), new Date(year, 11, 31).valueOf()));
  } else {
    const previousYear = end.getFullYear() - 1;
    const month = end.getMonth();
    // Foundation clamps February 29 to February 28 in the previous year.
    start.setFullYear(previousYear, month, 1);
    start.setDate(Math.min(end.getDate(), new Date(previousYear, month + 1, 0).getDate()));
    start.setDate(start.getDate() + 1);
  }
  const result: ActivityDay[] = [];
  for (const day = new Date(start); day <= last && result.length < 370;) {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    result.push({ date: localDateKey(day), startTime: day.valueOf() / 1000, endTime: next.valueOf() / 1000 });
    day.setTime(next.valueOf());
  }
  return result;
}

/** Sunday is the first row; empty cells align the first and last visible week. */
export function activityWeeks(days: ActivityDay[]): (ActivityDay | null)[][] {
  if (!days.length) return [];
  const leading = new Date(days[0].startTime * 1000).getDay();
  const slots: (ActivityDay | null)[] = [...Array<null>(leading).fill(null), ...days];
  while (slots.length % 7) slots.push(null);
  return Array.from({ length: slots.length / 7 }, (_, index) => slots.slice(index * 7, index * 7 + 7));
}

export function activityYears(firstStartTime: number | null | undefined, today: Date, selectedYear = 0): number[] {
  const current = today.getFullYear();
  const firstDate = firstStartTime && firstStartTime > 0 ? new Date(firstStartTime * 1000) : today;
  const first = Math.min(current, Number.isFinite(firstDate.valueOf()) ? firstDate.getFullYear() : current);
  const years = new Set(Array.from({ length: current - first + 1 }, (_, index) => current - index));
  if (selectedYear > 0 && selectedYear <= current) years.add(selectedYear);
  return [...years].sort((a, b) => b - a);
}

export function outcomeLayout(width: number, count: number) {
  const available = Number.isFinite(width) ? Math.max(20, width) : 20;
  const visibleColumns = Math.max(1, Math.floor((available + 4) / 28));
  const cellSize = (available - (visibleColumns - 1) * 4) / visibleColumns;
  const columns = Math.max(visibleColumns, Math.ceil(Math.max(0, count) / 5));
  return { cellSize, columns, visibleColumns, padding: columns * 5 - count };
}

/** Synthetic completion endpoint never consumes an actual or modded floor 50. */
export function floorRates(data: OverviewData): { label: string; value: number | null }[] {
  if (!data.summary.completed) return [];
  const values = new Map((data.survival ?? []).filter((row) => row.floor >= 1 && row.floor <= 49).map((row) => [row.floor, row.value]));
  return [
    ...Array.from({ length: 49 }, (_, index) => ({ label: String(index + 1), value: values.get(index + 1) ?? null })),
    { label: "50 · 通关", value: data.summary.wins / data.summary.completed },
  ];
}

export function signedRestValue(value: number | null, digits: number, multiplier = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "always" }).format(value * multiplier);
}
