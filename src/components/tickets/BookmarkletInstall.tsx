"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildBookmarklet } from "@/lib/discounts/bookmarklet";
import { cn } from "@/lib/utils";

/**
 * Draggable "Scan with Event Calendar" bookmarklet install UI, for sites the
 * scanner can never fetch server-side (Akamai bot walls, JS-rendered shells
 * — see DiscountSection's blocked/cantScan rows). Dragging the link to the
 * bookmarks bar once, then clicking it on a shop page, hands that page's own
 * (already-authenticated-in-the-user's-browser) HTML back to this app —
 * see bookmarklet.ts for the generated script and DiscountSection's
 * `receive=1` handler for the receiving end.
 *
 * `compact` renders a single-line variant meant to sit inside a blocked
 * source row's error message; the default renders the full help card with
 * step-by-step instructions.
 */
export function BookmarkletInstall({ compact = false }: { compact?: boolean }) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  // window.location.origin isn't available during SSR — computed post-mount
  // so the bookmarklet always points at wherever this app is actually
  // running (localhost/preview/production) instead of being baked in.
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of window.location on mount
    setOrigin(window.location.origin);
  }, []);

  const href = origin ? buildBookmarklet(origin) : null;

  // React 19 rejects a `javascript:` string passed straight to <a href> (it
  // silently rewrites it to a stub that throws instead of running) — set it
  // on the DOM node imperatively instead, once the origin (and therefore the
  // href) is known.
  useEffect(() => {
    if (href) linkRef.current?.setAttribute("href", href);
  }, [href]);

  const copyBookmarklet = async () => {
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return;
    } catch {
      // Clipboard API unavailable/denied (older browser, non-secure context,
      // permission denied) — fall back to a hidden, selected input so the
      // user can copy manually via the browser's own copy command instead.
    }
    const input = document.createElement("input");
    input.value = href;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Nothing more we can do here — the link itself is still visible and
      // draggable, so the user isn't fully stuck.
    } finally {
      document.body.removeChild(input);
    }
  };

  const link = (
    <a
      ref={linkRef}
      // Real href is set via setAttribute() above once known (React 19 note
      // above) — "#" is just a valid placeholder so the element is draggable
      // and focusable before then; the click handler below stops it from
      // ever navigating the app to itself.
      href="#"
      draggable
      onClick={(e) => e.preventDefault()}
      aria-label="Scan with Event Calendar bookmarklet — drag to your bookmarks bar"
      className={cn(
        "inline-flex shrink-0 cursor-grab items-center gap-1 rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 active:cursor-grabbing",
      )}
      title="Drag this to your bookmarks bar"
    >
      <MousePointerClick className="size-3" />
      Scan with Event Calendar
    </a>
  );

  const copyButton = (
    <button
      type="button"
      onClick={copyBookmarklet}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      title="Copy bookmarklet link"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      Copy bookmarklet
    </button>
  );

  if (compact) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {link}
        <span className="text-[11px] text-muted-foreground">drag to bookmarks bar, open the site, click it</span>
        {copyButton}
      </div>
    );
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">One-click scan for blocked sites</CardTitle>
        <CardDescription className="text-xs">
          For sites this scanner can never read from a server — drag the link below to your
          bookmarks bar once, then click it on any shop page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {link}
          <Button variant="outline" size="sm" onClick={copyBookmarklet} className="gap-1.5">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            Copy bookmarklet
          </Button>
        </div>
        <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
          <li>Drag &quot;Scan with Event Calendar&quot; above to your browser&apos;s bookmarks bar</li>
          <li>Open the blocked shop page you want scanned</li>
          <li>Click the bookmark — this tab reopens ready to scan what it sees</li>
        </ol>
        <p className="text-[11px] text-muted-foreground">
          On mobile, dragging a bookmarklet doesn&apos;t work — use &quot;Copy bookmarklet&quot; above and
          paste it as the URL of a bookmark you create manually.
        </p>
      </CardContent>
    </Card>
  );
}
