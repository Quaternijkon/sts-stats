import {
  validateNormalizedRun,
  validateCareerProgress,
} from "../../Engine/domain/schemas";
import { parseRunText, parseProgressText } from "../../Engine/domain/parser";
import type { Dataset, SaveFile, GameVersion, NormalizedRunV2 } from "./models";

export const FOUNDATION_EPOCH = 978307200;
export function emptyDataset(): Dataset {
  return {
    runs: [],
    progress: null,
    source: "",
    importedAt: 0,
    manifest: {},
    fileRunIDs: {},
  };
}
export function validateDataset(value: unknown, game?: GameVersion): Dataset {
  if (!value || typeof value !== "object") throw new Error("本地数据格式无效");
  const d = value as Dataset;
  if (
    !Array.isArray(d.runs) ||
    typeof d.source !== "string" ||
    !Number.isFinite(d.importedAt)
  )
    throw new Error("本地数据格式无效");
  const runs = d.runs.map(validateNormalizedRun);
  if (game && runs.some((run) => detectedGame(run) !== game))
    throw new Error("数据属于另一个游戏，请返回首页选择对应游戏");
  if (new Set(runs.map((r) => r.id)).size !== runs.length)
    throw new Error("数据包含重复对局标识");
  const manifest = stringMap(d.manifest, "文件清单");
  const byID = new Set(runs.map((run) => run.id));
  const legacyIDs = Object.fromEntries(
    Object.keys(manifest)
      .filter((path) => path.toLowerCase().endsWith(".run"))
      .map((path) => [path, path.split(/[\\/]/).at(-1)!]),
  );
  const fileRunIDs = Object.fromEntries(
    Object.entries(stringMap(d.fileRunIDs ?? legacyIDs, "文件对局映射"))
      .filter(([, id]) => byID.has(id)),
  );
  const importMetadata = d.importMetadata ?? {};
  if (!importMetadata || typeof importMetadata !== "object" || Array.isArray(importMetadata))
    throw new Error("导入记录格式无效");
  for (const meta of Object.values(importMetadata)) {
    if (!meta || !Number.isFinite(meta.modifiedAt) || typeof meta.digest !== "string" ||
      !Array.isArray(meta.versions) || meta.versions.some((version) => typeof version !== "string"))
      throw new Error("导入记录格式无效");
  }
  const progress = d.progress == null ? null : validateCareerProgress(d.progress);
  if (game === "sts1" && progress !== null)
    throw new Error("生涯存档属于杀戮尖塔 2，请选择对应游戏");
  return {
    runs,
    progress,
    source: d.source,
    importedAt: d.importedAt,
    manifest,
    fileRunIDs,
    importMetadata: structuredClone(importMetadata),
  };
}
function stringMap(value: unknown, label: string): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "string"))
    throw new Error(`${label}格式无效`);
  return { ...value } as Record<string, string>;
}
function detectedGame(run: NormalizedRunV2): GameVersion {
  if (run.gameVersion === "sts1" || run.gameVersion === "sts2") return run.gameVersion;
  const raw = run.raw as Record<string, unknown> | undefined;
  return raw?.play_id && raw.character_chosen && Array.isArray(raw.master_deck) ? "sts1" : "sts2";
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function runKey(run: NormalizedRunV2): Promise<string> {
  return digest(
    stable(
      run.startTime > 0 && run.seed
        ? {
            start: run.startTime,
            seed: run.seed,
            players: run.players.map((p) => ({
              id: p.id,
              character: p.character,
            })),
            mode: run.gameMode,
          }
        : run.raw ?? run,
    ),
  );
}

/** Prepare an entire transaction in the worker; never mutate the previous dataset. */
export async function prepareImport(
  previous: Dataset,
  files: SaveFile[],
  source: string,
  game: GameVersion,
): Promise<Dataset> {
  if (files.filter((f) => f.name.toLowerCase() === "progress.save").length > 1)
    throw new Error("包含多个 progress.save，请选择单一账号或 Profile");
  const sameSource = previous.source === source;
  const base = sameSource ? previous : emptyDataset();
  if (base.runs.some((run) => detectedGame(run) !== game) || (game === "sts1" && base.progress))
    throw new Error("数据属于另一个游戏，请选择对应游戏");
  if (!files.length && !base.runs.length && !base.progress)
    throw new Error("所选位置没有 .run 或 progress.save 文件");
  const next: Dataset = {
    ...base,
    source,
    importedAt: Date.now() / 1000 - FOUNDATION_EPOCH,
    manifest: { ...base.manifest },
    fileRunIDs: { ...base.fileRunIDs },
    importMetadata: structuredClone(base.importMetadata ?? {}),
  };
  const pool = new Map<string, NormalizedRunV2>();
  for (const run of base.runs) pool.set(await runKey(run), run);
  const ids = new Map(base.runs.map((r) => [r.id, r]));
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    try {
      if (!file.path || !Number.isFinite(file.modifiedAt) || file.modifiedAt < 0 ||
        (!file.name.toLowerCase().endsWith(".run") && file.name.toLowerCase() !== "progress.save"))
        throw new Error("不支持的存档文件");
      if (file.name.toLowerCase() === "progress.save" && game !== "sts2")
        throw new Error("这是二代生涯存档，请选择杀戮尖塔 2");
      const hash = await digest(file.text);
      if (next.manifest[file.path] === hash) continue;
      if (file.name.toLowerCase() === "progress.save") {
        next.progress = validateCareerProgress(parseProgressText(file.text));
      } else {
        const trimmed = file.text.trim();
        const jsonStart = trimmed.indexOf("{");
        const jsonEnd = trimmed.lastIndexOf("}");
        const raw = JSON.parse(jsonStart >= 0 && jsonEnd > jsonStart
          ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed);
        if (
          game === "sts1" &&
          Array.isArray(raw.players) &&
          Array.isArray(raw.map_point_history)
        )
          throw new Error("这是二代存档，请选择杀戮尖塔 2");
        const parsed = validateNormalizedRun(
          parseRunText(file.text, file.name, game),
        );
        if (parsed.gameVersion !== game)
          throw new Error("存档属于另一个游戏，请选择对应游戏");
        const key = await runKey(parsed);
        const existing = pool.get(key);
        const meta = next.importMetadata![key];
        if (
          meta &&
          meta.digest !== hash &&
          meta.modifiedAt === file.modifiedAt &&
          !meta.versions.includes(hash)
        )
          throw new Error(
            "同一对局存在时间相同、内容不同的版本，无法确定最新版本",
          );
        const alreadyArchived = meta?.versions.includes(hash) ?? false;
        const isNewer = !meta || file.modifiedAt > meta.modifiedAt;
        if (!existing || (!alreadyArchived && isNewer)) {
          const id =
            existing?.id ?? (ids.has(parsed.id) ? key + ".run" : parsed.id);
          const value = {
            ...parsed,
            id,
            sourceKey: id,
            importedAt: existing?.importedAt ?? parsed.importedAt,
            fileName: existing?.fileName ?? parsed.fileName,
          };
          pool.set(key, value);
          ids.set(id, value);
        }
        const latest = pool.get(key)!;
        next.fileRunIDs[file.path] = latest.id;
        next.importMetadata![key] = {
          digest: !meta || (!alreadyArchived && isNewer) ? hash : meta.digest,
          modifiedAt: !meta || (!alreadyArchived && isNewer) ? file.modifiedAt : meta.modifiedAt,
          versions: [...new Set([...(meta?.versions ?? []), hash])],
        };
      }
      next.manifest[file.path] = hash;
    } catch (error) {
      throw new Error(
        `${file.name}：${error instanceof Error ? error.message : String(error)}\n本次同步未提交，原有数据保持不变。`,
      );
    }
  }
  const progressPath = files.find((file) => file.name.toLowerCase() === "progress.save")?.path;
  if (progressPath) {
    for (const path of Object.keys(next.manifest)) {
      if (path !== progressPath && path.split(/[\\/]/).at(-1)?.toLowerCase() === "progress.save")
        delete next.manifest[path];
    }
  }
  next.runs = [...pool.values()].sort((a, b) => a.id.localeCompare(b.id));
  return next;
}

export interface ImportTransaction {
  dataset: Dataset;
  changed: boolean;
  serialized: string;
}
/** Comparison and JSON serialization run in the analysis worker, including archive restores. */
export async function prepareImportTransaction(
  previous: Dataset,
  files: SaveFile[],
  source: string,
  game: GameVersion,
  current: Dataset = previous,
): Promise<ImportTransaction> {
  const imported = await prepareImport(previous, files, source, game);
  const changed = JSON.stringify({ ...imported, importedAt: current.importedAt }) !== JSON.stringify(current);
  const dataset = changed ? imported : current;
  return { dataset, changed, serialized: JSON.stringify(dataset) };
}
