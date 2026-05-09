"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Calendar } from "lucide-react";
import type { SearchResult } from "@/app/api/events/search/route";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectEvent: (eventId: string) => void;
}

export function SearchDialog({ open, onOpenChange, onSelectEvent }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) { setResults([]); setLoading(false); return; }

    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const timer = setTimeout(() => {
      fetch(`/api/events/search?q=${encodeURIComponent(q)}&limit=20`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => { setResults(Array.isArray(data) ? data : []); setActiveIndex(0); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);

    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query, open]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback((id: string) => {
    onSelectEvent(id);
    onOpenChange(false);
  }, [onSelectEvent, onOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[activeIndex]) { handleSelect(results[activeIndex]!.id); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden" aria-describedby={undefined}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search events by title or artist…"
            className="border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-base bg-transparent"
          />
          {loading && <div className="size-4 border-2 border-muted border-t-foreground rounded-full animate-spin shrink-0" />}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && query.trim().length > 0 && !loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No events found for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.length === 0 && query.trim().length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Start typing to search your events
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => handleSelect(r.id)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === activeIndex ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <div className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: r.calendarColor }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="size-3 shrink-0" />
                  {r.calendarName} · {new Date(r.startTime).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="border-t px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
