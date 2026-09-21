import { useEffect, useState } from 'react';

// Module-level (survives component unmount/remount, i.e. switching tabs and back),
// but resets on a full page reload — no stale data ever persists across sessions.
const cache = new Map<string, unknown>();

/**
 * Clears a cached key so the NEXT mount of whatever uses it fetches fresh instead of
 * showing stale data first. Use this right after an action that you know invalidates a
 * specific cached list — e.g. after a spin wins a prize, the 'inventory' cache is stale
 * until this is called, since useCachedFetch's own background refetch only runs on mount,
 * not on every action that could have changed the data.
 */
export function invalidateCache(key: string) {
  cache.delete(key);
}

/**
 * Fetches `fetcher()` and caches the result under `key`. On every mount:
 *  - if a cached value exists, it's returned immediately (no loading flash), and
 *    a fresh fetch still runs quietly in the background to update it
 *  - if there's no cached value yet, behaves like a normal loading fetch
 *
 * This is what actually fixes the "3 second delay every time I switch tabs" feeling —
 * Tasks/Inventory/History were re-fetching and showing a blank loading screen on every
 * single visit, even though the data rarely changes between visits.
 */
export function useCachedFetch<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T) ?? null);
  const [error, setError] = useState<unknown>(null);

  async function refetch() {
    try {
      const res = await fetcher();
      cache.set(key, res);
      setData(res);
      setError(null);
      return res;
    } catch (err) {
      if (!cache.has(key)) setError(err);
      throw err;
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((res) => {
        if (cancelled) return;
        cache.set(key, res);
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep showing stale cached data on a transient network error instead of
        // wiping the screen — only surface the error if we never had data at all.
        if (!cache.has(key)) setError(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, isLoading: data === null && error === null, refetch };
}
