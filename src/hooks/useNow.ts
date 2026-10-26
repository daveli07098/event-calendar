import { useEffect, useState } from "react";

/**
 * Current time as a Date, ticking every `intervalMs`. The first render uses
 * `initialIso` (the server render time) so hydration matches; the clock is
 * caught up right after mount.
 */
export function useNow(intervalMs: number, initialIso?: string): Date {
  const [now, setNow] = useState(() => (initialIso ? Date.parse(initialIso) : Date.now()));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the external clock after hydration
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return new Date(now);
}
