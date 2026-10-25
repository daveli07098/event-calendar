"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";

interface FeedInfo {
  url: string | null;
  webcalUrl: string | null;
}

export function CalendarFeedSettings() {
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user/feed-token", { method });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setFeed((await res.json()) as FeedInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/feed-token")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<FeedInfo>;
      })
      .then((data) => {
        if (!cancelled) setFeed(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Something went wrong");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async () => {
    if (!feed?.url) return;
    await navigator.clipboard.writeText(feed.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerate = () => {
    if (
      window.confirm(
        "Regenerate the link? Calendars subscribed to the old link will stop updating.",
      )
    ) {
      void call("POST");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Subscribe once in iPhone or Google Calendar so your phone alerts you for
        events and ticket sales, even when this app is closed.
      </p>

      {!feed ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : feed.url ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              readOnly
              value={feed.url}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={feed.webcalUrl ?? feed.url}
              className={buttonVariants({ size: "sm" })}
            >
              Add to iPhone/Mac Calendar
            </a>
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.webcalUrl ?? feed.url)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Add to Google Calendar
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={regenerate}
              disabled={busy}
            >
              <RefreshCw className="size-4" />
              Regenerate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => call("DELETE")}
              disabled={busy}
            >
              Turn off
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keep this link private: anyone with it can see your events.
          </p>
        </div>
      ) : (
        <Button size="sm" onClick={() => call("POST")} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Create subscription link
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
