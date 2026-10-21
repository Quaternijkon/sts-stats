import { create } from "zustand";
import { platform } from "../services/platform";
import { analysisClient } from "../worker/client";
import { useAppStore } from "./appStore";
import { syncDecision } from "../services/sync/decision";
import type { AccountUser, CloudVault, SyncCheckpoint } from "../services/sync/types";
import type { GameVersion } from "../services/models";

class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request<T>(method: string, route: string, value?: unknown): Promise<T> {
  const body = value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value);
  const accountId = ["/auth/register", "/auth/login", "/auth/session"].includes(route) ? undefined : useAccountStore.getState().user?.id;
  const result = await platform.accountRequest(method, route, body, accountId);
  let response: any;
  try { response = result.body.length > 256 * 1024 ? await analysisClient(route.includes("sts1") ? "sts1" : "sts2").call({ op: "parseJson", text: result.body }) : JSON.parse(result.body); } catch { throw new AccountError(result.status, "此站点暂未提供账户服务"); }
  if (result.status < 200 || result.status >= 300) throw new AccountError(result.status, response.error ?? "账户服务暂时不可用");
  return response as T;
}
type Conflict = { game: GameVersion; localRuns: number; remoteRuns: number; revision: number; fingerprint: string };
interface AccountState {
  user: AccountUser | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  status: string;
  conflicts: Conflict[];
  initialize(): Promise<void>;
  authenticate(mode: "login" | "register", username: string, password: string, invite?: string): Promise<boolean>;
  logout(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  sync(resolution?: { game: GameVersion; choice: "local" | "remote"; revision: number; fingerprint: string }): Promise<void>;
  changePassword(password: string, newPassword: string): Promise<boolean>;
  deleteAccount(password: string): Promise<boolean>;
}
let started: Promise<void> | null = null;
let running: Promise<void> | null = null;
let generation = 0;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const useAccountStore = create<AccountState>((set, get) => ({
  user: null, ready: false, busy: false, error: null, status: "未登录", conflicts: [],
  async initialize() {
    if (started) return started;
    started = (async () => {
      await useAppStore.getState().initialize();
      try {
        const { user } = await request<{ user: AccountUser }>("GET", "/auth/session");
        set({ user, status: "已登录" });
        const settings = useAppStore.getState().accountSync;
        if (settings.accountId !== user.id) await useAppStore.getState().setAccountSync({ accountId: user.id, enabled: false, games: {} });
      } catch { /* Anonymous use and static-only deployments remain available. */ }
      finally { set({ ready: true }); }
    })();
    return started;
  },
  async authenticate(mode, username, password, invite) {
    if (get().busy) return false;
    set({ busy: true, error: null });
    try {
      const { user } = await request<{ user: AccountUser }>("POST", `/auth/${mode}`, { username, password, invite });
      generation++;
      set({ user, status: "已登录", conflicts: [] });
      const settings = useAppStore.getState().accountSync;
      await useAppStore.getState().setAccountSync(settings.accountId === user.id
        ? { ...settings, enabled: false } : { accountId: user.id, enabled: false, games: {} });
      return true;
    } catch (error) { set({ error: errorMessage(error) }); return false; }
    finally { set({ busy: false }); }
  },
  async logout() {
    if (get().busy) return;
    generation++;
    await useAppStore.getState().setAccountSync({ ...useAppStore.getState().accountSync, enabled: false });
    await running;
    set({ busy: true, error: null });
    try {
      await request("POST", "/auth/logout", {});
      set({ user: null, conflicts: [], status: "未登录" });
    } catch (error) { set({ error: errorMessage(error) }); }
    finally { set({ busy: false }); }
  },
  async setEnabled(enabled) {
    if (!get().user || get().busy) return;
    generation++;
    await useAppStore.getState().setAccountSync({ ...useAppStore.getState().accountSync, accountId: get().user!.id, enabled });
    set({ error: null, status: enabled ? "等待同步" : "已暂停" });
    if (enabled) await get().sync();
  },
  async sync(resolution) {
    const settings = useAppStore.getState().accountSync;
    const user = get().user;
    if (running || get().busy || !user || !settings.enabled || settings.accountId !== user.id || useAppStore.getState().busy) return;
    const ticket = generation;
    const valid = () => ticket === generation && useAppStore.getState().accountSync.enabled && useAppStore.getState().accountSync.accountId === user.id && get().user?.id === user.id;
    running = (async () => {
      set({ busy: true, error: null, status: "正在同步" });
      try {
        const { vaults } = await request<{ vaults: (SyncCheckpoint & { game: GameVersion })[] }>("GET", "/vaults");
        const conflicts: Conflict[] = [];
        for (const game of ["sts1", "sts2"] as const) {
          if (!valid()) return;
          let local = await useAppStore.getState().prepareAccountSnapshot(game);
          const meta = vaults.find((vault) => vault.game === game);
          let choice = syncDecision(local.fingerprint, local.empty, useAppStore.getState().accountSync.games[game], meta);
          if (resolution?.game === game) {
            if (resolution.revision !== (meta?.revision ?? 0)) throw new Error("云端已再次更新，请重新确认冲突");
            if (resolution.fingerprint !== local.fingerprint) throw new Error("本机数据已再次更新，请重新确认冲突");
            choice = resolution.choice === "local" ? "upload" : "download";
          }
          if (!valid()) return;
          let checkpoint: SyncCheckpoint | undefined;
          if (choice === "upload") {
            local = await useAppStore.getState().prepareAccountSnapshot(game, true);
            const body = await analysisClient(game).call<string>({ op: "serializeJson", pretty: false, value: { revision: meta?.revision ?? 0, fingerprint: local.fingerprint, payload: local.payload } });
            if (!valid()) return;
            checkpoint = await request<SyncCheckpoint>("PUT", `/vaults/${game}`, body);
          } else if (choice === "download" || choice === "conflict") {
            const existing = get().conflicts.find((conflict) => conflict.game === game && conflict.revision === (meta?.revision ?? 0) && conflict.fingerprint === local.fingerprint);
            if (choice === "conflict" && existing) { conflicts.push(existing); continue; }
            const remote = meta ? await request<CloudVault>("GET", `/vaults/${game}`) : null;
            if (!valid()) return;
            if (choice === "conflict") {
              const parsed = remote ? await analysisClient(game).call<{ dataset: { runs: unknown[] }; fingerprint: string }>({ op: "parseCloud", game, text: remote.payload }) : null;
              if (remote && parsed?.fingerprint !== remote.fingerprint) throw new Error("云端数据校验失败，本机数据保留");
              conflicts.push({ game, localRuns: local.runs, remoteRuns: parsed?.dataset.runs.length ?? 0, revision: remote?.revision ?? 0, fingerprint: local.fingerprint });
              continue;
            }
            if (!remote) throw new Error("云端数据已不存在，本机数据保留");
            const checked = await analysisClient(game).call<{ fingerprint: string }>({ op: "parseCloud", game, text: remote.payload });
            if (checked.fingerprint !== remote.fingerprint) throw new Error("云端数据校验失败，本机数据保留");
            if (!valid()) return;
            await useAppStore.getState().applyAccountSnapshot(game, remote.payload, user.id, local.identity, local.favorites);
            checkpoint = remote;
          } else if (choice === "equal") checkpoint = meta;
          if (checkpoint && valid()) {
            const current = useAppStore.getState().accountSync;
            const { revision, fingerprint, updated } = checkpoint;
            await useAppStore.getState().setAccountSync({ ...current, games: { ...current.games, [game]: { revision, fingerprint, updated } } });
          }
        }
        if (valid()) set({ conflicts, status: conflicts.length ? "需要处理同步冲突" : "已同步" });
      } catch (error) {
        if (valid()) {
          set({ error: errorMessage(error), status: "同步未完成" });
          if (error instanceof AccountError && error.status === 401) {
            set({ user: null, status: "登录已过期" });
            await useAppStore.getState().setAccountSync({ ...useAppStore.getState().accountSync, enabled: false });
          }
        }
      } finally { set({ busy: false }); }
    })().finally(() => { running = null; });
    await running;
  },
  async changePassword(password, newPassword) {
    if (get().busy) return false;
    set({ busy: true, error: null });
    try { await request("POST", "/auth/password", { password, newPassword }); set({ status: "密码已更新，其他设备需重新登录" }); return true; }
    catch (error) { set({ error: errorMessage(error) }); return false; }
    finally { set({ busy: false }); }
  },
  async deleteAccount(password) {
    if (get().busy) return false;
    set({ busy: true, error: null });
    try {
      await request("POST", "/auth/delete", { password });
      generation++;
      await useAppStore.getState().setAccountSync({ enabled: false, games: {} });
      set({ user: null, conflicts: [], status: "账户和云端数据已删除，本机数据保留" });
      return true;
    } catch (error) { set({ error: errorMessage(error) }); return false; }
    finally { set({ busy: false }); }
  },
}));
