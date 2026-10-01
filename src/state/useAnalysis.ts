import { useEffect, useId, useRef, useState } from "react";
import { analysisClient } from "../worker/client";
import { useAppStore } from "./appStore";

export function useAnalysis<T>(
  request: Record<string, unknown>,
  options: { unfiltered?: boolean } = {},
) {
  const game = useAppStore((s) => s.game);
  const revision = useAppStore((s) => s.revision);
  const filter = useAppStore((s) => s.filter);
  const ready = useAppStore((s) => s.ready);
  const group = useId();
  const cache = useRef(new Map<string, { data: T; bytes: number }>());
  const cacheBytes = useRef(0);
  const identity = useRef("");
  const dataIdentity = `${game}/${revision}`;
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify({
    ...request,
    ...(options.unfiltered
      ? {}
      : { filter: { ...filter, ...((request.filter as object) ?? {}) } }),
  });
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
    identity: string;
    requestKey: string;
    resolvedRequestKey: string | null;
  }>({ data: null, loading: true, error: null, identity: dataIdentity, requestKey: key, resolvedRequestKey: null });
  useEffect(() => {
    if (!ready) {
      cache.current.clear();
      cacheBytes.current = 0;
      identity.current = "";
      setState({ data: null, loading: true, error: null, identity: dataIdentity, requestKey: key, resolvedRequestKey: null });
      return;
    }
    const version = `${game}/${revision}/${retry}`;
    if (identity.current !== version) {
      identity.current = version;
      cache.current.clear();
      cacheBytes.current = 0;
    }
    if (cache.current.has(key)) {
      const entry = cache.current.get(key)!;
      cache.current.delete(key);
      cache.current.set(key, entry);
      analysisClient(game).cancelGroup(group);
      setState({ data: entry.data, loading: false, error: null, identity: dataIdentity, requestKey: key, resolvedRequestKey: key });
      return;
    }
    let active = true;
    setState((s) => ({
      data: s.identity === dataIdentity ? s.data : null,
      resolvedRequestKey: s.identity === dataIdentity ? s.resolvedRequestKey : null,
      loading: true, error: null, identity: dataIdentity, requestKey: key,
    }));
    analysisClient(game)
      .callMeasured<T>(JSON.parse(key), group)
      .then(({ result: data, bytes: measuredBytes }) => {
        if (active) {
          const bytes = measuredBytes + key.length * 2;
          if (measuredBytes > 0 && bytes <= 8 * 1024 * 1024) {
            cache.current.set(key, { data, bytes });
            cacheBytes.current += bytes;
            while (cache.current.size > 6 || cacheBytes.current > 8 * 1024 * 1024) {
              const oldest = cache.current.keys().next().value!;
              cacheBytes.current -= cache.current.get(oldest)!.bytes;
              cache.current.delete(oldest);
            }
          }
          setState({ data, loading: false, error: null, identity: dataIdentity, requestKey: key, resolvedRequestKey: key });
        }
      })
      .catch((error) => {
        if (active)
          setState({ data: null, loading: false, error: error.message, identity: dataIdentity, requestKey: key, resolvedRequestKey: null });
      });
    return () => {
      active = false;
      analysisClient(game).cancelGroup(group);
    };
  }, [game, revision, key, retry, ready, group, dataIdentity]);
  const current = ready && state.identity === dataIdentity;
  const currentRequest = current && state.requestKey === key;
  return {
    data: current ? state.data : null,
    loading: !currentRequest || state.loading,
    error: currentRequest ? state.error : null,
    requestKey: key,
    resolvedRequestKey: current ? state.resolvedRequestKey : null,
    isCurrent: current && state.resolvedRequestKey === key,
    reload: () => setRetry((n) => n + 1),
  };
}
