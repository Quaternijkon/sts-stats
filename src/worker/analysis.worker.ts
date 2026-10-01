import { arenaSvg } from "../services/arenaExport";
import type { PreferenceArenaResult } from "../../Engine/domain/preferenceArena";
import { dispatch } from "../../Engine/bridge";
import { prepareImport, validateDataset } from "../services/dataset";
import type { Dataset, SaveFile, GameVersion } from "../services/models";
import { zhCharacter } from "../../Engine/domain/i18n";

let queue = Promise.resolve();
const cache = new Map<string, { result: unknown; bytes: number }>();
let cacheBytes = 0;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const request = data.request as Record<string, unknown>;
      let result: unknown;
      if (request.op === "arenaSvg") {
        result = arenaSvg(
          request.result as PreferenceArenaResult,
          request.order as string[],
        );
      } else if (request.op === "prepareImport") {
        result = await prepareImport(
          request.previous as Dataset,
          request.files as SaveFile[],
          request.source as string,
          request.game as GameVersion,
        );
      } else if (request.op === "validateDataset")
        result = validateDataset(request.dataset, request.game as GameVersion);
      else if (request.op === "runPage") {
        const response = JSON.parse(
          dispatch(
            JSON.stringify({
              op: request.coop ? "coop" : "runs",
              filter: request.filter,
            }),
          ),
        );
        let runs = (request.coop ? response.runs : response) as Dataset["runs"];
        const search = String(request.search ?? "")
          .trim()
          .toLocaleLowerCase();
        const favorites = request.favorites as string[] | null;
        runs = runs.filter(
          (run) =>
            (!favorites || favorites.includes(run.id)) &&
            (!search ||
              [
                run.id,
                run.seed,
                run.buildId,
                new Date(run.startTime * 1000).toLocaleDateString("zh-CN"),
                ...run.players.map((p) => zhCharacter(p.character)),
              ]
                .join(" ")
                .toLocaleLowerCase()
                .includes(search)),
        );
        const sort = request.sort as { field: string; direction: string };
        const direction = sort?.direction === "asc" ? 1 : -1;
        runs.sort((a, b) => {
          const left = a[sort?.field ?? "startTime"];
          const right = b[sort?.field ?? "startTime"];
          return (
            (typeof left === "string" && typeof right === "string"
              ? left.localeCompare(right)
              : Number(left) - Number(right)) * direction ||
            a.id.localeCompare(b.id)
          );
        });
        const offset = Math.max(0, Number(request.offset) || 0);
        result = {
          runs: runs.slice(
            offset,
            offset + Math.min(500, Number(request.limit) || 100),
          ),
          total: runs.length,
          compositions: response.compositions,
        };
      } else {
        const key = JSON.stringify(request);
        if (request.op === "load") {
          cache.clear();
          cacheBytes = 0;
        }
        const hit = cache.get(key);
        if (hit) {
          cache.delete(key);
          cache.set(key, hit);
          result = hit.result;
        } else {
          const text = dispatch(key);
          result = JSON.parse(text);
          if (
            !["parse", "load", "csv", "label"].includes(String(request.op)) &&
            text.length < 4 * 1024 * 1024
          ) {
            const entry = { result, bytes: text.length * 2 };
            cache.set(key, entry);
            cacheBytes += entry.bytes;
            while (cache.size > 36 || cacheBytes > 32 * 1024 * 1024) {
              const first = cache.keys().next().value!;
              cacheBytes -= cache.get(first)!.bytes;
              cache.delete(first);
            }
          }
        }
      }
      scope.postMessage({ id: data.id, result });
    } catch (error) {
      scope.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

scope.postMessage({ ready: true });
