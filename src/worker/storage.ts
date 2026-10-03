import type { GameVersion } from "../services/models";

export interface WorkerStorage {
  loadDatasetText(game: GameVersion, identity: string): Promise<string | null>;
  readDerived(game: GameVersion, identity: string, key: string): Promise<string | null>;
  writeDerived(game: GameVersion, identity: string, key: string, text: string): Promise<void>;
}
type Reply = { storageResponse: number; result?: unknown; error?: string };
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
let sequence = 0;
function call<T>(method: keyof WorkerStorage, args: unknown[]): Promise<T> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    self.postMessage({ storage: true, id, method, args });
  });
}
export function receiveStorageReply(value: Reply): boolean {
  if (typeof value.storageResponse !== "number") return false;
  const entry = pending.get(value.storageResponse);
  pending.delete(value.storageResponse);
  if (value.error) entry?.reject(new Error(value.error));
  else entry?.resolve(value.result);
  return true;
}
export const workerStorage: WorkerStorage = {
  loadDatasetText: (...args) => call("loadDatasetText", args),
  readDerived: (...args) => call("readDerived", args),
  writeDerived: (...args) => call("writeDerived", args),
};
