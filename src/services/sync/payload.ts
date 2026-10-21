import { validateDataset } from "../dataset";
import type { Dataset, GameVersion } from "../models";
import type { CloudPayload, PreparedCloud } from "./types";

async function hash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function transferable(dataset: Dataset): Dataset {
  return { runs: dataset.runs, progress: dataset.progress, source: "", importedAt: dataset.importedAt, manifest: {}, fileRunIDs: {} };
}
export async function prepareCloud(dataset: Dataset, favorites: string[], game: GameVersion): Promise<PreparedCloud> {
  const data = transferable(dataset);
  const payload = JSON.stringify({ schema: 1, game, dataset: data, favorites: [...new Set(favorites)].sort() } satisfies CloudPayload);
  return { payload, fingerprint: await hash(payload), datasetFingerprint: await hash(JSON.stringify(data)), empty: !dataset.runs.length && !dataset.progress && !favorites.length, runs: dataset.runs.length };
}
export async function parseCloud(text: string, game: GameVersion) {
  const value = JSON.parse(text) as CloudPayload;
  if (value.schema !== 1 || value.game !== game || !Array.isArray(value.favorites) || value.favorites.some((id) => typeof id !== "string")) throw new Error("云端数据格式无效");
  const dataset = validateDataset(value.dataset, game);
  const prepared = await prepareCloud(dataset, value.favorites, game);
  return { ...prepared, dataset, favorites: value.favorites };
}
