import { arenaSvg } from "../services/arenaExport";
import type { PreferenceArenaResult } from "../../Engine/domain/preferenceArena";
import { prepareImport, prepareImportTransaction, validateDataset } from "../services/dataset";
import type { Dataset, SaveFile, GameVersion, LegacySourceData } from "../services/models";
import { arenaCsv, serializeCsv } from "./exports";
import { AnalysisRuntime } from "./runtime";
import { receiveStorageReply, workerStorage } from "./storage";
import { legacyPreferences, prepareLegacyDataset } from "../services/legacyMigration";
import type { Preferences } from "../services/models";
import { setCurrentGame } from "../../Engine/domain/game";
import { prepareCloud, parseCloud } from "../services/sync/payload";

let queue = Promise.resolve();
const runtime = new AnalysisRuntime(workerStorage);
self.onmessage = ({ data }) => {
  if (receiveStorageReply(data)) return;
  queue = queue.then(async () => {
    try {
      const request = data.request as Record<string, unknown>;
      if (request.game === "sts1" || request.game === "sts2") setCurrentGame(request.game);
      let result: unknown;
      let bytes = 0;
      if (request.op === "prepareCloud") result = await prepareCloud(request.dataset as Dataset, request.favorites as string[], request.game as GameVersion);
      else if (request.op === "parseCloud") result = await parseCloud(request.text as string, request.game as GameVersion);
      else if (request.op === "arenaSvg") result = arenaSvg(request.result as PreferenceArenaResult, request.order as string[]);
      else if (request.op === "arenaCsv") result = arenaCsv(request.result as PreferenceArenaResult, request.order as string[]);
      else if (request.op === "serializeCsv") result = serializeCsv(request.headers as unknown[], request.rows as unknown[][]);
      else if (request.op === "prepareImport") result = await prepareImport(request.previous as Dataset, request.files as SaveFile[], request.source as string, request.game as GameVersion);
      else if (request.op === "prepareImportTransaction") {
        const transaction = await prepareImportTransaction(request.previous as Dataset, request.files as SaveFile[], request.source as string, request.game as GameVersion, request.current as Dataset | undefined);
        result = transaction;
        bytes = transaction.serialized.length * 4;
      } else if (request.op === "prepareLegacyDataset") {
        result = await prepareLegacyDataset(request.payload as LegacySourceData, request.previous as Dataset, request.game as GameVersion);
        bytes = (result as { serialized: string }).serialized.length * 2;
      } else if (request.op === "parseJson") result = JSON.parse(request.text as string);
      else if (request.op === "parseDataset") result = validateDataset(JSON.parse(request.text as string), request.game as GameVersion);
      else if (request.op === "validateDataset") result = validateDataset(request.dataset, request.game as GameVersion);
      else if (request.op === "legacyPreferences") result = legacyPreferences(request.current as Preferences, request.values as Record<string, unknown>, request.mappings as Parameters<typeof legacyPreferences>[2]);
      else if (request.op === "serializeDataset") result = JSON.stringify(request.dataset);
      else if (request.op === "serializeJson") {
        result = JSON.stringify(request.value, null, request.pretty === false ? undefined : 2);
        if (result === undefined) throw new Error("没有可导出的数据");
      } else {
        const response = await runtime.handle(request);
        result = response.result;
        bytes = response.bytes;
      }
      if (!bytes && result != null) bytes = typeof result === "string" ? result.length * 2 : (JSON.stringify(result)?.length ?? 0) * 2;
      self.postMessage({ id: data.id, result, bytes });
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
self.postMessage({ ready: true });
