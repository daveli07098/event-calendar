/**
 * Thin `fetch` wrapper for state-changing calls (POST/PUT/PATCH/DELETE).
 *
 * Every mutation below was previously fire-and-forget: no `res.ok` check,
 * no rollback of optimistic UI, no feedback to the user on failure — the UI
 * looked like it succeeded while the server did nothing. `mutate()` gives a
 * single place that:
 *   - checks `res.ok` and parses the API's `{ error: string }` body (see
 *     e.g. `src/app/api/calendars/[id]/route.ts`) to get a server message
 *   - surfaces a `toast.error` with that message, or a sensible fallback
 *     when the body has none / isn't JSON / the request never reached the
 *     server (network failure)
 *   - supports an optional optimistic update + rollback: call
 *     `optimisticUpdate()` before the request fires, and `rollback()` if it
 *     turns out to have failed
 *
 * It is deliberately NOT a data-fetching framework — no caching, retries,
 * or dedup. Just enough ergonomics to stop mutations from failing silently.
 */
import { toast } from "sonner";

export interface MutateOptions<T> {
  /** HTTP method — defaults to "POST". */
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body to send; omitted entirely (and no Content-Type header) if undefined. */
  body?: unknown;
  /** Applied synchronously before the request fires (optimistic UI update). */
  optimisticUpdate?: () => void;
  /** Invoked if the request fails (non-OK response or thrown/network error) to undo optimisticUpdate. */
  rollback?: () => void;
  /** Shown via toast.error when the response has no usable `{ error }` message. */
  fallbackError?: string;
  /** Shown via toast.success on a 2xx response; a function receives the parsed body. */
  successMessage?: string | ((data: T) => string);
  /** Suppress the error toast — the caller renders its own inline error state instead. */
  silent?: boolean;
}

export interface MutateResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const DEFAULT_FALLBACK_ERROR = "Something went wrong. Please try again.";

export async function mutate<T = unknown>(
  url: string,
  options: MutateOptions<T> = {},
): Promise<MutateResult<T>> {
  const {
    method = "POST",
    body,
    optimisticUpdate,
    rollback,
    fallbackError = DEFAULT_FALLBACK_ERROR,
    successMessage,
    silent = false,
  } = options;

  optimisticUpdate?.();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    // Request never reached the server (offline, DNS failure, CORS, etc).
    rollback?.();
    if (!silent) toast.error(fallbackError);
    return { ok: false, error: fallbackError };
  }

  if (!res.ok) {
    rollback?.();
    let message = fallbackError;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON or empty error body — stick with the fallback.
    }
    if (!silent) toast.error(message);
    return { ok: false, error: message };
  }

  let data: T | undefined;
  try {
    data = await res.json();
  } catch {
    // 204 No Content or otherwise body-less success response.
    data = undefined;
  }

  if (successMessage) {
    toast.success(
      typeof successMessage === "function" ? successMessage(data as T) : successMessage,
    );
  }

  return { ok: true, data };
}
