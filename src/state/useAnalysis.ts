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
  const cache = useRef(new Map<string, T>());
  const identity = useRef("");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });
  const key = JSON.stringify({
    ...request,
    ...(options.unfiltered
      ? {}
      : { filter: { ...filter, ...((request.filter as object) ?? {}) } }),
  });
  useEffect(() => {
    if (!ready) return;
    const version = `${game}/${revision}/${retry}`;
    if (identity.current !== version) {
      identity.current = version;
      cache.current.clear();
    }
    if (cache.current.has(key)) {
      const data = cache.current.get(key)!;
      cache.current.delete(key);
      cache.current.set(key, data);
      setState({ data, loading: false, error: null });
      return;
    }
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    analysisClient(game)
      .call<T>(JSON.parse(key), group)
      .then((data) => {
        if (active) {
          cache.current.set(key, data);
          while (cache.current.size > 6)
            cache.current.delete(cache.current.keys().next().value!);
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (active)
          setState({ data: null, loading: false, error: error.message });
      });
    return () => {
      active = false;
    };
  }, [game, revision, key, retry, ready, group]);
  return { ...state, reload: () => setRetry((n) => n + 1) };
}
