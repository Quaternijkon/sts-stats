import { formatDuration, formatDate } from "../../Engine/domain/analytics";
const identities: Record<string, string> = {
  Ironclad: "ironclad",
  Silent: "silent",
  Regent: "regent",
  Necrobinder: "necrobinder",
  Defect: "defect",
  Watcher: "watcher",
};
function normalize(id: string) {
  return (
    Object.keys(identities).find(
      (k) => k.toLowerCase() === id.replace(/^CHARACTER\./i, "").toLowerCase(),
    ) ?? id
  );
}
export function characterColor(id: string): string {
  const value = identities[normalize(id)];
  return value ? `var(--character-${value})` : characterAccentColor(id);
}
export function characterAccentColor(id: string): string {
  const known: Record<string, string> = {
    Ironclad: "#f02e2e",
    Silent: "#1fc259",
    Regent: "#ffa30a",
    Necrobinder: "#a347fa",
    Defect: "#147dff",
    Watcher: "#a847db",
  };
  const key = normalize(id);
  if (known[key]) return known[key];
  let hash = 0;
  for (const c of key) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
  return `hsl(${(hash >>> 0) % 360} 65% 47%)`;
}
export function overallCharacterColor(characters: string[]): string {
  return characters.reduce(
    (mixed, id, index) =>
      index === 0
        ? characterAccentColor(id)
        : `color-mix(in oklab, ${mixed} ${(index / (index + 1)) * 100}%, ${characterAccentColor(id)} ${100 / (index + 1)}%)`,
    "var(--accent)",
  );
}
function interpolate(a: number[], b: number[], fraction: number) {
  const p = Math.min(1, Math.max(0, fraction));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(" ")})`;
}
export function numericColor(value: number): string {
  const p = Math.min(1, Math.max(0, value));
  return p < 0.5
    ? interpolate([46, 122, 224], [51, 173, 171], p * 2)
    : interpolate([51, 173, 171], [255, 115, 36], (p - 0.5) * 2);
}
export function rateColor(value: number): string {
  const p = Math.min(1, Math.max(0, value));
  return p < 0.5
    ? interpolate([235, 65, 63], [227, 180, 25], p * 2)
    : interpolate([227, 180, 25], [44, 169, 81], (p - 0.5) * 2);
}
export function preferenceColor(value: number): string {
  const p = Math.min(1, Math.max(0, value));
  return p < 0.5
    ? interpolate([79, 87, 199], [242, 241, 247], p * 2)
    : interpolate([242, 241, 247], [16, 117, 100], (p - 0.5) * 2);
}
export function preferenceTextColor(value: number): string {
  const rgb = preferenceColor(value).match(/\d+/g)!.map(Number);
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
export function formatValue(value: unknown, format = "number"): string {
  if (value == null || (typeof value === "number" && !Number.isFinite(value)))
    return "—";
  if (typeof value !== "number") return String(value);
  if (format === "percent")
    return new Intl.NumberFormat("zh-CN", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  if (format === "duration") return formatDuration(value);
  if (format === "date") return formatDate(value);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
    value,
  );
}
