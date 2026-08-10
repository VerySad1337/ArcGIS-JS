import { useCallback, useEffect, useRef } from "react";

// Default interval between commits, in ms. ~12 commits/second: fast enough
// that a drag still reads as live, slow enough that a 60Hz pointer stream
// stops driving 60 ArcGIS renderer rebuilds per second.
const DEFAULT_WAIT_MS = 80;

/**
 * Returns a stable, throttled wrapper around `callback`.
 *
 * Leading-edge: the first call in a burst runs synchronously, so a single
 * discrete interaction (a click, one keyboard nudge of a slider) behaves
 * exactly as it did before and needs no waiting. Subsequent calls inside the
 * window are coalesced and the most recent arguments are flushed on the
 * trailing edge, so the final value a user drags to is always committed - a
 * plain "drop everything inside the window" throttle would lose it.
 *
 * This exists for the continuous-drag inputs in LayerControlPanel, where every
 * pointer event reaches GISMapEngine and costs a symbol clone / renderer
 * rebuild plus a full getLayers() projection. See knowledge/features/
 * performance.md.
 */
export default function useThrottledCallback(callback, waitMs = DEFAULT_WAIT_MS) {
  // The latest callback is held in a ref so the returned function's identity
  // stays stable across re-renders (it is itself usually passed to a memoized
  // child) without ever invoking a stale closure.
  const callbackRef = useRef(callback);
  const lastRunAtRef = useRef(0);
  const timeoutRef = useRef(null);
  const pendingArgsRef = useRef(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  return useCallback(
    (...args) => {
      const elapsed = Date.now() - lastRunAtRef.current;

      if (elapsed >= waitMs) {
        lastRunAtRef.current = Date.now();
        callbackRef.current(...args);
        return;
      }

      pendingArgsRef.current = args;
      if (timeoutRef.current) return;

      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        lastRunAtRef.current = Date.now();
        const pending = pendingArgsRef.current;
        pendingArgsRef.current = null;
        if (pending) callbackRef.current(...pending);
      }, waitMs - elapsed);
    },
    [waitMs]
  );
}
