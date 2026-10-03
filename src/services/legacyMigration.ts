import { OBJECT_KINDS } from "../../Engine/domain/objectTypes";
import { EMPTY_FILTER, filterSpecSchema, validateCareerProgress, validateNormalizedRun } from "../../Engine/domain/schemas";
import { parseProgressText, parseRunText } from "../../Engine/domain/parser";
import { FOUNDATION_EPOCH, emptyDataset, runKey, validateDataset } from "./dataset";
import type { Dataset, GameVersion, LegacySourceData, Preferences, FilterSpec, NormalizedRunV2 } from "./models";

function legacyFilter(value: unknown, objectConditions: boolean): FilterSpec {
  const input = value && typeof value === "object" ? value as Partial<FilterSpec> : {};
  const cleaned = { ...structuredClone(EMPTY_FILTER), ...input, party: "all" };
  if (!objectConditions) {
    cleaned.includeCards = []; cleaned.excludeCards = [];
    cleaned.includeRelics = []; cleaned.excludeRelics = [];
  }
  const parsed = filterSpecSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : structuredClone(EMPTY_FILTER);
}

/** Native UserDefaults data is supplied by the explicitly selected plist reader. */
export function legacyPreferences(current: Preferences, values: Record<string, unknown>, mappings: Partial<Record<GameVersion, Record<string, string[]>>> = {}): Preferences {
  const next = structuredClone(current);
  if (values.selectedGame === "sts1" || values.selectedGame === "sts2") next.selectedGame = values.selectedGame;
  if (["system", "light", "dark"].includes(String(values.appearance))) next.theme = values.appearance as Preferences["theme"];
  if (typeof values.minimumSample === "number" && Number.isFinite(values.minimumSample))
    next.minimumSample = Math.max(1, Math.min(1000, Math.floor(values.minimumSample)));
  for (const game of ["sts1", "sts2"] as const) {
    const prefix = game === "sts1" ? "sts1." : "";
    const saved = next.games[game];
    const favorites = values[prefix + "favorites"];
    if (Array.isArray(favorites)) saved.favorites = [...new Set([...saved.favorites, ...favorites.flatMap((id) =>
      typeof id === "string" ? mappings[game]?.[id] ?? [id] : [],
    )])];
    const autoSync = values[prefix + "autoSyncEnabled"];
    if (typeof autoSync === "boolean") {
      saved.legacyAutoSync = autoSync;
      if (saved.source) saved.autoSync = autoSync;
    }
    const lastSync = values[prefix + "lastSyncedAt"];
    if (typeof lastSync === "string" && Number.isFinite(Date.parse(lastSync))) saved.lastSyncedAt = Date.parse(lastSync);
    const queries = values[prefix + "savedQueries"];
    if (Array.isArray(queries)) saved.savedQueries = queries;
    saved.pageFilters = { ...saved.pageFilters };
    if (prefix + "analysisFilter" in values) {
      for (const page of ["dashboard", "rest"]) saved.pageFilters[page] = legacyFilter(values[prefix + "analysisFilter"], false);
    }
    if (prefix + "objectFilter" in values) {
      const objectFilter = legacyFilter(values[prefix + "objectFilter"], true);
      for (const kind of OBJECT_KINDS) {
        saved.pageFilters["objects/" + kind] = structuredClone(objectFilter);
        saved.pageFilters["detail/object/" + kind] = structuredClone(objectFilter);
      }
      saved.pageFilters.archetypes = structuredClone(objectFilter);
    }
    if (prefix + "soloRecordFilter" in values) saved.pageFilters.runs = legacyFilter(values[prefix + "soloRecordFilter"], true);
    if (prefix + "coopRecordFilter" in values) saved.pageFilters.coop = legacyFilter(values[prefix + "coopRecordFilter"], true);
  }
  return next;
}

function rawIdentity(run: NormalizedRunV2) { return JSON.stringify(run.raw); }

/** Merge a source, retain existing IDs, and reject ambiguous revisions before any write. */
export async function prepareLegacyDataset(payload: LegacySourceData, previous: Dataset, game: GameVersion) {
  const base = previous.source === payload.source ? validateDataset(previous, game) : emptyDataset();
  const incoming = payload.dataset == null ? { ...emptyDataset(), source: payload.source }
    : validateDataset(payload.dataset, game);
  if (incoming.source !== payload.source) throw new Error("旧来源与数据集不一致");
  const dataset: Dataset = {
    ...base, source: payload.source,
    importedAt: Math.max(base.importedAt, incoming.importedAt),
    manifest: { ...base.manifest, ...incoming.manifest },
    fileRunIDs: { ...base.fileRunIDs },
    importMetadata: structuredClone(base.importMetadata ?? {}),
  };
  if (incoming.progress && (!base.progress || incoming.importedAt > base.importedAt)) dataset.progress = incoming.progress;
  const pool = new Map<string, NormalizedRunV2>();
  const ids = new Set(base.runs.map((run) => run.id));
  const idMap: Record<string, string> = {};
  for (const run of base.runs) pool.set(await runKey(run), run);
  const entries = [
    ...incoming.runs.map((run) => ({ run, entry: null })),
    ...payload.runs.map((entry) => ({
      run: validateNormalizedRun({
        ...(entry.blob.endsWith(".json") ? JSON.parse(entry.text) : parseRunText(entry.text, entry.name, game)),
        id: entry.id, sourceKey: entry.id, fileName: entry.name, importedAt: entry.importedAt,
      }), entry,
    })),
  ];
  for (const { run, entry } of entries) {
    const key = await runKey(run);
    const existing = pool.get(key);
    const originalID = run.id;
    const id = existing?.id ?? (ids.has(run.id) ? `${key}.run` : run.id);
    const prior = dataset.importMetadata![key];
    const metadata = entry ? {
      modifiedAt: Math.max(0, entry.modified), digest: entry.blob.replace(/\.[^.]+$/, ""),
      versions: entry.versions.map((blob) => blob.replace(/\.[^.]+$/, "")),
    } : incoming.importMetadata?.[key];
    const same = existing && rawIdentity(existing) === rawIdentity(run);
    if (existing && !same && prior && metadata && prior.modifiedAt === metadata.modifiedAt &&
      prior.digest !== metadata.digest && !prior.versions.includes(metadata.digest))
      throw new Error("旧归档中存在同时间、不同内容的版本，迁移尚未提交");
    const newer = !existing || (metadata ? !prior || metadata.modifiedAt > prior.modifiedAt
      : incoming.importedAt > base.importedAt);
    if (!existing || (!same && newer)) pool.set(key, {
      ...run, id, sourceKey: id, importedAt: existing?.importedAt ?? run.importedAt,
      fileName: existing?.fileName ?? run.fileName,
    });
    ids.add(id);
    idMap[originalID] = id;
    if (metadata) dataset.importMetadata![key] = {
      modifiedAt: newer ? metadata.modifiedAt : prior?.modifiedAt ?? metadata.modifiedAt,
      digest: newer ? metadata.digest : prior?.digest ?? metadata.digest,
      versions: [...new Set([...(prior?.versions ?? []), ...metadata.versions, metadata.digest])],
    };
  }
  for (const [path, id] of Object.entries(incoming.fileRunIDs)) dataset.fileRunIDs[path] = idMap[id] ?? id;
  if (payload.progress) {
    const entry = payload.progress;
    const value = validateCareerProgress(entry.blob.endsWith(".json") ? JSON.parse(entry.text) : parseProgressText(entry.text));
    const importedAt = entry.importedAt / 1000 - FOUNDATION_EPOCH;
    if (!dataset.progress || importedAt > dataset.importedAt) dataset.progress = value;
    dataset.importedAt = Math.max(dataset.importedAt, importedAt);
  }
  if (!dataset.importedAt) dataset.importedAt = payload.runs.reduce((latest, entry) => Math.max(latest, entry.importedAt / 1000 - FOUNDATION_EPOCH), 0);
  dataset.runs = [...pool.values()].sort((left, right) => left.id.localeCompare(right.id));
  const validated = validateDataset(dataset, game);
  return { serialized: JSON.stringify(validated), idMap };
}
