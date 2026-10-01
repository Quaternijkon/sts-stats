import type { PreferenceArenaResult } from "../../Engine/domain/preferenceArena";
import { zhEntity } from "../../Engine/domain/i18n";

function csvRow(values: unknown[]): string {
  return values.map((value) => {
    const text = value == null || (typeof value === "number" && !Number.isFinite(value))
      ? "" : typeof value === "object" ? JSON.stringify(value) ?? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  }).join(",");
}

export function serializeCsv(headers: unknown[], rows: unknown[][]): string {
  return "\uFEFF" + [csvRow(headers), ...rows.map(csvRow)].join("\n");
}

/** The matrix can contain n² pairs; construct every exported row in the worker. */
export function arenaCsv(result: PreferenceArenaResult, order: string[]): string {
  const labels = new Map(order.map((id) => [id, zhEntity(id, result.itemCategory, id)]));
  const relations = { direct: "直接证据", indirect: "间接推断", na: "不可比较" };
  const lines = [csvRow(["行 ID", "行名称", "列 ID", "列名称", "偏好", "区间下限", "区间上限", "证据", "方向置信度", "共同出现次数", "行选择", "列选择", "其他选择", "共同邻居", "最短路径"])];
  for (const id of order) {
    for (const other of order) {
      const pair = result.pairs[`${id}¦${other}`];
      if (!pair) continue;
      lines.push(csvRow([
        id, labels.get(id), other, labels.get(other), pair.pref, pair.prefCi?.[0], pair.prefCi?.[1],
        relations[pair.relation], pair.directionConfidence, pair.cooccurN, pair.rowChoiceCount,
        pair.columnChoiceCount, pair.otherChoiceCount, pair.commonNeighbors, pair.shortestPath,
      ]));
    }
  }
  return "\uFEFF" + lines.join("\n");
}
