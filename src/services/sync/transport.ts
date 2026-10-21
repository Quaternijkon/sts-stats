import type { AccountResponse } from "./types";

/** The only browser network adapter. Native traffic uses its constrained Rust adapter. */
export async function browserAccountRequest(method: string, route: string, body?: string, accountId?: string): Promise<AccountResponse> {
  if (!["GET", "POST", "PUT"].includes(method) || !/^\/(?:auth\/(?:register|login|session|logout|password|delete)|vaults(?:\/sts[12])?)$/.test(route)) throw new Error("不支持的同步请求");
  const response = await fetch(new URL(`/api/v1${route}`, window.location.origin), {
    method, credentials: "same-origin", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(accountId ? { "X-STS-Account": accountId } : {}) }, body,
    signal: AbortSignal.timeout(120000), redirect: "error", cache: "no-store",
  });
  return { status: response.status, body: await response.text() };
}
