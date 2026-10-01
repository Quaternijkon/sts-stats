import type { PreferenceArenaResult } from "../../Engine/domain/preferenceArena";
import { zhEntity } from "../../Engine/domain/i18n";
import {
  preferenceColor,
  preferenceTextColor,
  formatValue,
} from "../styles/theme";
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function arenaSvg(
  result: PreferenceArenaResult,
  order: string[],
): string {
  const cell = 62,
    left = 240,
    top = 110,
    width = Math.max(660, left + cell * order.length),
    height = top + 34 * order.length + 30;
  const label = (id: string) => zhEntity(id, result.itemCategory, id);
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" fill="#202126"><text x="12" y="25" font-size="18">选择偏好矩阵</text><text x="12" y="48" font-size="11">行相对于列 · 低偏好蓝紫 → 50% 中性 → 高偏好青绿</text><text x="12" y="67" font-size="11">实线：直接证据 · 虚线：间接推断 · —：不可比较 · ·：自身</text>`,
  ];
  order.forEach((id, i) => {
    pieces.push(
      `<text x="12" y="${top + 34 * i + 22}" font-size="11">${i + 1} · ${xml(label(id))}</text><text x="${left + cell * i + 24}" y="${top - 12}" font-size="11">${i + 1}</text>`,
    );
    order.forEach((other, j) => {
      const pair = result.pairs[`${id}¦${other}`],
        value = pair?.pref,
        x = left + j * cell,
        y = top + i * 34;
      const fill =
        value == null ? "#f3f3f6" : preferenceColor(value).replaceAll(" ", ",");
      const ink = value == null ? "#202126" : preferenceTextColor(value);
      pieces.push(
        `<g><title>${xml(label(id))} / ${xml(label(other))} · ${pair?.relation ?? "self"} · ${pair?.cooccurN ?? 0}</title><rect x="${x + 2}" y="${y + 2}" width="${cell - 4}" height="30" rx="4" fill="${fill}" stroke="${pair?.relation === "na" || id === other ? "none" : "#999"}"${pair?.relation === "indirect" ? ' stroke-dasharray="3 3"' : ""}/><text x="${x + cell / 2}" y="${y + 22}" text-anchor="middle" font-size="11" fill="${ink}">${id === other ? "·" : value == null ? "—" : formatValue(value, "percent")}</text></g>`,
      );
    });
  });
  pieces.push("</g></svg>");
  return pieces.join("");
}
