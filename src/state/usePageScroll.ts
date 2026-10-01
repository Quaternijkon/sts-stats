import { useLayoutEffect, useRef } from "react";

/** Navigation restores each page; chart and filter changes keep the current viewport. */
export function usePageScroll(page: string) {
  const ref = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target = positions.current.get(page) ?? 0;
    let lastPosition = target;
    let pending = target > 0;
    let interacted = false;
    const resize = new ResizeObserver(() => restore());
    const observeChildren = () => {
      resize.disconnect();
      for (const child of element.children) resize.observe(child);
    };
    const stop = () => {
      pending = false;
      resize.disconnect();
      mutations.disconnect();
    };
    const restore = () => {
      if (!pending) return;
      element.scrollTop = target;
      if (Math.abs(element.scrollTop - target) < 1) { lastPosition = target; stop(); }
    };
    const mutations = new MutationObserver(() => {
      if (!pending) return;
      observeChildren();
      restore();
    });
    const interact = () => { interacted = true; lastPosition = element.scrollTop; stop(); };
    const track = () => { if (!pending || interacted) lastPosition = element.scrollTop; };
    element.scrollTop = target;
    if (pending) {
      mutations.observe(element, { childList: true, subtree: true });
      observeChildren();
      restore();
    }
    element.addEventListener("wheel", interact, { passive: true });
    element.addEventListener("touchstart", interact, { passive: true });
    element.addEventListener("pointerdown", interact);
    element.addEventListener("keydown", interact);
    element.addEventListener("scroll", track, { passive: true });
    return () => {
      const position = pending && !interacted ? target : lastPosition;
      stop();
      element.removeEventListener("wheel", interact);
      element.removeEventListener("touchstart", interact);
      element.removeEventListener("pointerdown", interact);
      element.removeEventListener("keydown", interact);
      element.removeEventListener("scroll", track);
      positions.current.delete(page);
      positions.current.set(page, position);
      while (positions.current.size > 64) positions.current.delete(positions.current.keys().next().value!);
    };
  }, [page]);
  return ref;
}
