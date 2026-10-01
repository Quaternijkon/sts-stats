import { arenaSvg } from "../services/arenaExport";
import type { PreferenceArenaResult } from "../../Engine/domain/preferenceArena";
import { dispatch } from "../../Engine/bridge";
import { prepareImport, prepareImportTransaction, validateDataset } from "../services/dataset";
import type { Dataset, SaveFile, GameVersion } from "../services/models";
import { storageSummary } from "./operations";
import { arenaCsv, serializeCsv } from "./exports";

let queue = Promise.resolve();
const cache = new Map<string, { result: unknown; bytes: number }>();
let cacheBytes = 0;
let loadedDataset: Dataset | null = null;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const request = data.request as Record<string, unknown>;
      let result: unknown;
      let resultBytes = 0;
      if (request.op === "arenaSvg") {
        result = arenaSvg(
          request.result as PreferenceArenaResult,
          request.order as string[],
        );
      } else if (request.op === "arenaCsv") {
        result = arenaCsv(request.result as PreferenceArenaResult, request.order as string[]);
      } else if (request.op === "serializeCsv") {
        result = serializeCsv(request.headers as unknown[], request.rows as unknown[][]);
      } else if (request.op === "prepareImport") {
        result = await prepareImport(
          request.previous as Dataset,
          request.files as SaveFile[],
          request.source as string,
          request.game as GameVersion,
        );
      } else if (request.op === "prepareImportTransaction") {
        const transaction = await prepareImportTransaction(
          request.previous as Dataset,
          request.files as SaveFile[],
          request.source as string,
          request.game as GameVersion,
          request.current as Dataset | undefined,
        );
        result = transaction;
        // The transaction already includes its serialization; measuring the
        // entire object would allocate another full dataset plus escaped copy.
        resultBytes = transaction.serialized.length * 4;
      } else if (request.op === "validateDataset")
        result = validateDataset(request.dataset, request.game as GameVersion);
      else if (request.op === "serializeJson") {
        result = JSON.stringify(request.value, null, request.pretty === false ? undefined : 2);
        if (result === undefined) throw new Error("没有可导出的数据");
      }
      else if (request.op === "exportDataset" || request.op === "serializeDataset") {
        const dataset = request.dataset ?? loadedDataset;
        if (!dataset) throw new Error("没有可导出的本地数据");
        result = request.op === "serializeDataset" ? JSON.stringify(dataset) : JSON.stringify(dataset, null, 2);
      } else if (request.op === "storageSummary") {
        if (!loadedDataset) throw new Error("分析数据尚未载入");
        result = storageSummary(loadedDataset);
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
          resultBytes = hit.bytes;
        } else {
          const text = dispatch(key);
          result = JSON.parse(text);
          resultBytes = text.length * 2;
          if (request.op === "load") {
            loadedDataset = {
              runs: request.runs as Dataset["runs"],
              progress: request.progress as Dataset["progress"],
              source: String(request.source ?? ""),
              importedAt: Number(request.importedAt) || 0,
              manifest: (request.manifest as Dataset["manifest"]) ?? {},
              fileRunIDs: (request.fileRunIDs as Dataset["fileRunIDs"]) ?? {},
              ...(request.importMetadata ? { importMetadata: request.importMetadata as Dataset["importMetadata"] } : {}),
            };
          }
          if (
            !["parse", "load", "csv", "label", "cardPoolCache", "runText"].includes(String(request.op)) &&
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
      if (!resultBytes) resultBytes = typeof result === "string" ? result.length * 2 : (JSON.stringify(result)?.length ?? 0) * 2;
      scope.postMessage({ id: data.id, result, bytes: resultBytes });
    } catch (error) {
      scope.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

scope.postMessage({ ready: true });
