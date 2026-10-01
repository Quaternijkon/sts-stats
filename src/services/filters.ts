import type { FilterSpec } from "./models";
import { EMPTY_FILTER } from "../../Engine/domain/schemas";
import { zhCharacter, zhGameMode, zhStatus } from "../../Engine/domain/i18n";

export interface FilterToken {
  key: keyof FilterSpec;
  title: string;
}

const names: Partial<Record<keyof FilterSpec, string>> = {
  characters: "角色", ascensions: "进阶", outcomes: "结果", party: "队伍",
  builds: "版本", mode: "模式", dateFrom: "从", dateTo: "至",
  abandonPolicy: "放弃记录", minDuration: "最短分钟", maxDuration: "最长分钟",
  includeCards: "包含卡牌", excludeCards: "排除卡牌",
  includeRelics: "包含遗物", excludeRelics: "排除遗物",
};
const order: (keyof FilterSpec)[] = [
  "characters", "ascensions", "outcomes", "dateFrom", "dateTo", "abandonPolicy",
  "party", "builds", "mode", "minDuration", "maxDuration",
  "includeCards", "excludeCards", "includeRelics", "excludeRelics",
];

export function activeFilterTokens(filter: FilterSpec): FilterToken[] {
  return order.flatMap((key) => {
    const value = filter[key];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return [];
    if ((key === "party" && value === "all") || (key === "abandonPolicy" && value === "include")) return [];
    const values = Array.isArray(value) ? value : [value];
    let label = values.map(String).join("、");
    if (key === "characters") label = values.map(zhCharacter).join("、");
    if (key === "ascensions") label = values.map((v) => `A${v}`).join("、");
    if (key === "outcomes") label = values.map(zhStatus).join("、");
    if (key === "mode") label = values.map(zhGameMode).join("、");
    if (key === "party") label = value === "solo" ? "单人" : "多人";
    if (key === "minDuration" || key === "maxDuration") label = String(Number(value) / 60);
    if (key === "abandonPolicy") label = value === "exclude-all"
      ? "排除全部放弃"
      : `排除不足 ${filter.shortAbandonMinutes ?? 5} 分钟的放弃`;
    return [{ key, title: `${names[key]}：${label}` }];
  });
}

export function removeFilterPatch(key: keyof FilterSpec): Partial<FilterSpec> {
  if (key === "abandonPolicy") return { abandonPolicy: "include", shortAbandonMinutes: 5 };
  return { [key]: structuredClone(EMPTY_FILTER[key]) };
}

export function dateRangePreset(days: number | null, now = new Date()): Pick<FilterSpec, "dateFrom" | "dateTo"> {
  if (days == null) return { dateFrom: null, dateTo: null };
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return { dateFrom: `${year}-${month}-${day}`, dateTo: null };
}

export function parseObjectIDs(text: string): string[] {
  return [...new Set(text.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean))];
}
