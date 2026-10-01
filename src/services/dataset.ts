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
  if (game && runs.some((run) => run.gameVersion && run.gameVersion !== game))
    throw new Error("数据属于另一个游戏，请返回首页选择对应游戏");
  if (new Set(runs.map((r) => r.id)).size !== runs.length)
    throw new Error("数据包含重复对局标识");
  return {
    ...d,
    runs,
    progress: d.progress == null ? null : validateCareerProgress(d.progress),
    manifest: d.manifest ?? {},
    fileRunIDs: d.fileRunIDs ?? {},
  };
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
        : run.raw,
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
  if (!files.length) throw new Error("所选位置没有 .run 或 progress.save 文件");
  if (files.filter((f) => f.name.toLowerCase() === "progress.save").length > 1)
    throw new Error("包含多个 progress.save，请选择单一账号或 Profile");
  const sameSource = !previous.source || previous.source === source;
  const base = sameSource ? previous : emptyDataset();
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
      const hash = await digest(file.text);
      if (next.manifest[file.path] === hash) continue;
      if (file.name.toLowerCase() === "progress.save") {
        next.progress = validateCareerProgress(parseProgressText(file.text));
      } else {
        const raw = JSON.parse(file.text.trim());
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
            fileName: existing?.fileName ?? parsed.fileName,
          };
          pool.set(key, value);
          ids.set(id, value);
        }
        const latest = pool.get(key)!;
        next.fileRunIDs[file.path] = latest.id;
        next.importMetadata![key] = {
          digest: !meta || isNewer ? hash : meta.digest,
          modifiedAt: Math.max(file.modifiedAt, meta?.modifiedAt ?? 0),
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
  next.runs = [...pool.values()].sort((a, b) => a.id.localeCompare(b.id));
  return next;
}
