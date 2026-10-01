import type { GameVersion } from "../services/models";
type Pending = {
  id: number;
  request: Record<string, unknown>;
  group?: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};
class AnalysisClient {
  private worker: Worker;
  private sequence = 0;
  private active: Pending | null = null;
  private queue: Pending[] = [];
  private ready = false;
  constructor() {
    this.worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }) => {
      if (data.ready) {
        this.ready = true;
        this.pump();
        return;
      }
      const entry = this.active;
      if (!entry || entry.id !== data.id) return;
      this.active = null;
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
      this.pump();
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "分析引擎无法启动");
      this.active?.reject(error);
      this.active = null;
      for (const entry of this.queue) entry.reject(error);
      this.queue = [];
    };
  }
  private pump() {
    if (!this.ready || this.active || !this.queue.length) return;
    this.active = this.queue.shift()!;
    this.worker.postMessage({
      id: this.active.id,
      request: this.active.request,
    });
  }
  call<T>(request: Record<string, unknown>, group?: string): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      if (group)
        this.queue = this.queue.filter((entry) => {
          if (entry.group !== group) return true;
          entry.reject(new Error("请求已被新选择替代"));
          return false;
        });
      this.queue.push({ id, request, group, resolve, reject });
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
