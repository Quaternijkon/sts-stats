import type { GameVersion } from "../services/models";
type Pending = {
  id: number;
  request: Record<string, unknown>;
  group?: string;
  resolve: (value: any, bytes: number) => void;
  reject: (error: Error) => void;
};
export class AnalysisClient {
  private worker!: Worker;
  private sequence = 0;
  private active: Pending | null = null;
  private queue: Pending[] = [];
  private ready = false;
  private failed = false;
  private lastLoad: Record<string, unknown> | null = null;
  constructor(private createWorker: () => Worker = () =>
    new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" }),
  ) {
    try { this.start(); } catch { this.failed = true; }
  }
  private start() {
    this.ready = false;
    this.failed = false;
    this.worker = this.createWorker();
    const worker = this.worker;
    this.worker.onmessage = ({ data }) => {
      if (worker !== this.worker || this.failed) return;
      if (data.ready) {
        this.ready = true;
        this.pump();
        return;
      }
      const entry = this.active;
      if (!entry || entry.id !== data.id) return;
      this.active = null;
      if (data.error) entry.reject(new Error(data.error));
      else {
        if (entry.request.op === "load") this.lastLoad = entry.request;
        entry.resolve(data.result, Number(data.bytes) || 0);
      }
      this.pump();
    };
    this.worker.onerror = (event) => { if (worker === this.worker) this.fail(new Error(event.message || "分析引擎无法启动")); };
    this.worker.onmessageerror = () => { if (worker === this.worker) this.fail(new Error("分析结果无法读取")); };
  }
  private fail(error: Error) {
    this.failed = true;
    this.ready = false;
    this.worker.terminate();
    this.active?.reject(error);
    this.active = null;
    for (const entry of this.queue) entry.reject(error);
    this.queue = [];
  }
  private pump() {
    if (!this.ready || this.active || !this.queue.length) return;
    this.active = this.queue.shift()!;
    try {
      this.worker.postMessage({
        id: this.active.id,
        request: this.active.request,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  call<T>(request: Record<string, unknown>, group?: string): Promise<T> {
    return this.callMeasured<T>(request, group).then(({ result }) => result);
  }
  cancelGroup(group: string) {
    this.queue = this.queue.filter((entry) => {
      if (entry.group !== group) return true;
      entry.reject(new Error("请求已被新选择替代"));
      return false;
    });
  }
  callMeasured<T>(request: Record<string, unknown>, group?: string): Promise<{ result: T; bytes: number }> {
    const id = ++this.sequence;
    return new Promise<{ result: T; bytes: number }>((resolve, reject) => {
      if (this.failed) {
        try {
          this.start();
        } catch (error) {
          this.failed = true;
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (this.lastLoad && request.op !== "load") this.queue.push({
          id: ++this.sequence, request: this.lastLoad,
          resolve: () => {}, reject: () => {},
        });
      }
      if (group) this.cancelGroup(group);
      this.queue.push({ id, request, group, resolve: (result, bytes) => resolve({ result, bytes }), reject });
      this.pump();
    });
  }
}
const clients = new Map<GameVersion, AnalysisClient>();
export function analysisClient(game: GameVersion): AnalysisClient {
  let client = clients.get(game);
  if (!client) {
    client = new AnalysisClient();
    clients.set(game, client);
  }
  return client;
}
