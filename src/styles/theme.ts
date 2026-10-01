import { formatDuration, formatDate } from "../../Engine/domain/analytics";
import { zhCharacter, zhMapType } from "../../Engine/domain/i18n";

export type NumericSemantic = "number" | "rate" | "preference";

const identities: Record<string, string> = {
  Ironclad: "ironclad",
  Silent: "silent",
  Regent: "regent",
  Necrobinder: "necrobinder",
  Defect: "defect",
  Watcher: "watcher",
};
export function normalizeCharacterId(id: string): string {
  const raw = id.trim();
  const key = raw.replace(/^CHARACTER\./i, "").replace(/^The\s+/i, "");
  return Object.keys(identities).find(
    (known) => known.toLowerCase() === key.toLowerCase() || zhCharacter(known) === raw,
  ) ?? key;
}

function stableHash(key: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(key)) {
    hash = Math.imul(hash ^ byte, 16777619);
  }
  return hash >>> 0;
}

export function categoricalColor(key: string): string {
  const palette = ["defect", "regent", "silent", "necrobinder", "ironclad", "time", "pink", "gold"];
  return `var(--category-${palette[stableHash(key) % palette.length]})`;
}
export function characterColor(id: string): string {
  const key = normalizeCharacterId(id);
  const value = identities[key];
  if (!key || /^(unknown|未知)$/i.test(key)) return "var(--muted)";
  return value ? `var(--character-${value})` : categoricalColor(`character:${key}`);
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
  const key = normalizeCharacterId(id);
  if (known[key]) return known[key];
  if (!key || /^(unknown|未知)$/i.test(key)) return "var(--accent)";
  return `hsl(${stableHash(`character-accent:${key}`) % 360} 72% 48%)`;
}
export function overallCharacterColor(characters: string[]): string {
  // Equivalent IDs count once; sorting and pagination cannot change the mix.
  const ids = [...new Set(characters.map(normalizeCharacterId))].filter(Boolean);
  return ids.reduce(
    (mixed, id, index) =>
      index === 0
        ? characterAccentColor(id)
        : `color-mix(in oklab, ${mixed} ${(index / (index + 1)) * 100}%, ${characterAccentColor(id)} ${100 / (index + 1)}%)`,
    "var(--accent)",
  );
}

export function roomColor(id: string): string {
  const known = ["monster", "enemy", "elite", "boss", "event", "unknown", "shop", "merchant", "rest", "rest_site", "treasure", "ancient"];
  const key = known.find((value) => value === id.toLowerCase() || zhMapType(value) === id) ?? id.toLowerCase();
  if (["monster", "enemy"].includes(key)) return "var(--damage)";
  if (["elite", "ancient"].includes(key)) return "var(--streak)";
  if (key === "boss") return "var(--choice)";
  if (["rest", "rest_site"].includes(key)) return "var(--health)";
  if (["shop", "merchant", "treasure"].includes(key)) return "var(--gold)";
  return key === "event" ? "var(--time)" : "var(--muted)";
}

export function objectColor(kind: string, id = ""): string {
  switch (kind.toLowerCase()) {
    case "character": return characterColor(id);
    case "card": case "cards": case "enchantment": case "modifier": return "var(--choice)";
    case "relic": case "relics": case "badge": case "epoch": case "achievement": return "var(--gold)";
    case "enemy": case "encounter": case "encounters": return "var(--damage)";
    case "ancient": case "ancients": return "var(--streak)";
    case "run": case "runs": case "date": case "week": case "event": case "location": return "var(--time)";
    case "roomtype": case "room_type": return roomColor(id);
    case "ascension": case "floor": case "act": return "var(--floor)";
    case "restchoice": return "var(--health)";
    case "archetype": case "archetypes": case "party": return categoricalColor(`${kind.toLowerCase()}:${id}`);
    case "outcome": case "status": return id === "win" ? "var(--success)" : id === "loss" ? "var(--damage)" : "var(--muted)";
    default: return "var(--accent)";
  }
}

function metricKey(id: string): string {
  return id.replace(/^(summary|metrics|career)\./, "").replace(/[_\s-]/g, "").toLowerCase();
}

export function metricSemantic(id: string): NumericSemantic {
  const key = metricKey(id);
  if (/pickrate|pickcilow|pickcihigh|preference|choicerate/.test(key)) return "preference";
  if (/winrate|winci|survivalrate|arrivalrate|reachrate|completionrate/.test(key) || ["cilow", "cihigh"].includes(key)) return "rate";
  return "number";
}

export function metricColor(id: string): string {
  const key = metricKey(id);
  if (/streak/.test(key)) return "var(--streak)";
  if (/win|survival|health|healed/.test(key) || /hp$/.test(key) || ["cilow", "cihigh"].includes(key)) return "var(--success)";
  if (/damage|loss|death/.test(key)) return "var(--damage)";
  if (/duration|time/.test(key)) return "var(--time)";
  if (/gold/.test(key) || key === "totalunlocks") return "var(--gold)";
  if (/floor|ascension/.test(key) || key === "act") return "var(--floor)";
  if (/pick|choice|decksize|turns/.test(key)) return "var(--choice)";
  if (/sample|share|offered|runs|observations/.test(key) || key === "total") return "var(--sample)";
  return "var(--accent)";
}

function fraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}
function interpolate(a: number[], b: number[], fraction: number) {
  const p = Math.min(1, Math.max(0, fraction));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(" ")})`;
}
export function numericColor(value: number): string {
  if (!Number.isFinite(value)) return "var(--muted)";
  const p = fraction(value);
  return p < 0.5
    ? interpolate([46, 122, 224], [51, 173, 171], p * 2)
    : interpolate([51, 173, 171], [255, 115, 36], (p - 0.5) * 2);
}
export function rateColor(value: number): string {
  if (!Number.isFinite(value)) return "var(--muted)";
  const p = fraction(value);
  return p < 0.5
    ? interpolate([235, 65, 63], [227, 180, 25], p * 2)
    : interpolate([227, 180, 25], [44, 169, 81], (p - 0.5) * 2);
}
export function preferenceColor(value: number): string {
  if (!Number.isFinite(value)) return "var(--muted)";
  const p = fraction(value);
  return p < 0.5
    ? interpolate([79, 87, 199], [242, 241, 247], p * 2)
    : interpolate([242, 241, 247], [16, 117, 100], (p - 0.5) * 2);
}
export function preferenceTextColor(value: number): string {
  if (!Number.isFinite(value)) return "var(--text)";
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
