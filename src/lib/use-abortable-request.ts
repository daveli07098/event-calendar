"use client";

import { useCallback, useEffect, useRef } from "react";

/** Why a given request's AbortSignal was aborted. */
export type AbortReason = "timeout" | "cancel" | "superseded" | "unmount";

/**
 * Manages one or more in-flight abortable fetches, keyed by an optional string
 * (defaults to a single implicit key for callers that only ever have one
 * request in flight at a time — e.g. TicketSection's scrape flow — while
 * DiscountSection keys by source URL so several rows can scan concurrently).
 *
 * Each call to `start()` gets its own AbortController that:
 *  - auto-aborts after `timeoutMs` (reason "timeout") so a stalled AI provider
 *    call doesn't hang forever with only a disabled button as feedback,
 *  - can be aborted early via `cancel()`/`cancelAll()` (reason "cancel") when
 *    the user clicks a Cancel button,
 *  - is aborted on unmount (reason "unmount") so navigating away doesn't leak
 *    a pending request/state update.
 *
 * Callers should read `signal.reason` in their catch block to distinguish a
 * timeout from a user cancel from a genuine network error, and react
 * accordingly (distinct message vs. silent return-to-idle vs. generic error).
 */
export function useAbortableRequest(defaultTimeoutMs = 45_000) {
  const controllers = useRef(new Map<string, AbortController>());

  // Abort everything still in flight when the component unmounts.
  useEffect(() => {
    const map = controllers.current;
    return () => {
      map.forEach((c) => c.abort("unmount" satisfies AbortReason));
      map.clear();
    };
  }, []);

  const start = useCallback(
    (key = "default", timeoutMs = defaultTimeoutMs): AbortSignal => {
      // A new request under the same key supersedes any still running one.
      controllers.current.get(key)?.abort("superseded" satisfies AbortReason);
      const controller = new AbortController();
      controllers.current.set(key, controller);
      const timer = setTimeout(() => {
        if (controllers.current.get(key) === controller) {
          controller.abort("timeout" satisfies AbortReason);
        }
      }, timeoutMs);
      // Clear the timer as soon as the request settles either way, so it
      // doesn't fire (harmlessly) after the controller is already discarded.
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      return controller.signal;
    },
    [defaultTimeoutMs]
  );

  /** User-initiated cancel of the request under `key` (default: the implicit single key). */
  const cancel = useCallback((key = "default") => {
    controllers.current.get(key)?.abort("cancel" satisfies AbortReason);
  }, []);

  /** Cancel every request currently tracked, regardless of key. */
  const cancelAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort("cancel" satisfies AbortReason));
  }, []);

  return { start, cancel, cancelAll };
}
