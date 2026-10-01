import { useState, type Dispatch, type SetStateAction } from "react";

const views = new Map<string, unknown>();
const MAX_VIEW_VALUES = 192;

/** Retain parent-list state during detail navigation without keeping datasets. */
export function useObjectViewState<T>(scope: string, field: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const key = `${scope}:${field}`;
  const read = () => views.has(key) ? views.get(key) as T : initial;
  const [state, setState] = useState(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  const update: Dispatch<SetStateAction<T>> = (next) => {
    setState((previous) => {
      const current = previous.key === key ? previous.value : read();
      const value = typeof next === "function" ? (next as (value: T) => T)(current) : next;
      views.delete(key);
      views.set(key, value);
      while (views.size > MAX_VIEW_VALUES) views.delete(views.keys().next().value!);
      return { key, value };
    });
  };
  return [value, update];
}
