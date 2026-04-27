"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ticket, Sparkles, ExternalLink, CalendarPlus, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface AiQuota { used: number; limit: number; remaining: number }

interface ScrapedTicket {
  title: string;
  date: string | null;       // ISO string or natural language
  time: string | null;
  venue: string | null;
  location: string | null;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string;
  aiUsed: string;            // which AI provider processed it
  aiQuota: AiQuota;
}

type Status = "idle" | "scraping" | "scraped" | "adding" | "done" | "error";

export function TicketSection() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [ticket, setTicket] = useState<ScrapedTicket | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [addedCalendarName, setAddedCalendarName] = useState("");
  const [quota, setQuota] = useState<AiQuota | null>(null);

  const handleScrape = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setStatus("scraping");
    setTicket(null);
    setErrorMsg("");

    try {
      const res = await fetch("/api/tickets/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to scrape the URL");
        setStatus("error");
        return;
      }

      setTicket(data);
      if (data.aiQuota) setQuota(data.aiQuota);
      setStatus("scraped");
    } catch {
      setErrorMsg("Network error — please try again");
      setStatus("error");
    }
  };

  const handleAddToCalendar = async () => {
    if (!ticket) return;

    setStatus("adding");

    try {
      const res = await fetch("/api/tickets/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to add event");
        setStatus("scraped");
        return;
      }

      setAddedCalendarName(data.calendarName ?? "ticket-reminders");
      setStatus("done");
      toast.success(`Event added to "${data.calendarName}"!`);
    } catch {
      toast.error("Network error — please try again");
      setStatus("scraped");
    }
  };

  const handleReset = () => {
    setUrl("");
    setStatus("idle");
    setTicket(null);
    setErrorMsg("");
    setAddedCalendarName("");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Ticket className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Ticket Section</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {quota && (
            <Badge
              variant={quota.remaining <= 5 ? "destructive" : "outline"}
              className="text-xs tabular-nums"
            >
              {quota.remaining}/{quota.limit} AI calls left today
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">
            <Sparkles className="size-3 mr-1" />
            AI-powered
          </Badge>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        {/* Intro */}
        <div className="space-y-1">
          <h2 className="text-2xl font-bold">Auto-import your tickets</h2>
          <p className="text-muted-foreground text-sm">
            Paste any event or ticket URL (Eventbrite, Ticketmaster, KKTIX, Accupass, etc.)
            and AI will extract the details and add it to a{" "}
            <span className="font-semibold text-foreground">ticket-reminders</span> calendar
            automatically.
          </p>
        </div>

        {/* URL Input */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Paste ticket URL</CardTitle>
            <CardDescription>
              We fetch the page server-side, extract event info with AI, then create the calendar
              entry for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="url"
                placeholder="https://www.eventbrite.com/e/your-event..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && status === "idle" && handleScrape()}
                disabled={status === "scraping" || status === "adding"}
                className="flex-1"
              />
              <Button
                onClick={handleScrape}
                disabled={!url.trim() || status === "scraping" || status === "adding" || status === "done"}
              >
                {status === "scraping" ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" /> Scanning…
                  </>
                ) : (
                  "Scan"
                )}
              </Button>
            </div>

            {/* Supported sites hint */}
            <p className="text-xs text-muted-foreground">
              Works best with: Eventbrite · Ticketmaster · KKTIX · Accupass · Meetup · Lu.ma ·
              any site with proper Open Graph or Schema.org markup
            </p>
          </CardContent>
        </Card>

        {/* Error */}
        {status === "error" && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-start gap-3 pt-4">
              <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Could not extract ticket info</p>
                <p className="text-xs text-muted-foreground">{errorMsg}</p>
                <Button variant="outline" size="sm" onClick={handleReset} className="mt-2">
                  Try another URL
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Scraped preview */}
        {(status === "scraped" || status === "adding" || status === "done") && ticket && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base leading-snug">{ticket.title}</CardTitle>
                <a
                  href={ticket.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <Button variant="ghost" size="icon" className="size-7">
                    <ExternalLink className="size-3.5" />
                  </Button>
                </a>
              </div>
              <CardDescription className="text-xs">
                Extracted by{" "}
                <span className="font-medium capitalize">{ticket.aiUsed}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {ticket.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ticket.imageUrl}
                  alt={ticket.title}
                  className="w-full h-40 object-cover rounded-md"
                />
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                {ticket.date && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Date</p>
                    <p>{ticket.date}</p>
                  </div>
                )}
                {ticket.time && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Time</p>
                    <p>{ticket.time}</p>
                  </div>
                )}
                {ticket.venue && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Venue</p>
                    <p>{ticket.venue}</p>
                  </div>
                )}
                {ticket.location && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Location</p>
                    <p>{ticket.location}</p>
                  </div>
                )}
              </div>

              {ticket.description && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-muted-foreground line-clamp-3">{ticket.description}</p>
                </div>
              )}

              {/* Actions */}
              {status === "scraped" && (
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleAddToCalendar} className="flex-1">
                    <CalendarPlus className="size-4 mr-2" />
                    Add to ticket-reminders
                  </Button>
                  <Button variant="outline" onClick={handleReset}>
                    Clear
                  </Button>
                </div>
              )}

              {status === "adding" && (
                <Button disabled className="w-full">
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Adding to calendar…
                </Button>
              )}

              {status === "done" && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="size-4" />
                    Added to <span className="font-semibold">{addedCalendarName}</span>
                  </div>
                  <div className="flex gap-2">
                    <Link href="/" className="flex-1">
                      <Button variant="outline" className="w-full">
                        View calendar
                      </Button>
                    </Link>
                    <Button variant="outline" onClick={handleReset}>
                      Add another
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* AI provider info */}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            Which AI is used for extraction?
          </summary>
          <div className="mt-2 space-y-1 pl-2 border-l border-border">
            <p>The server checks for these env vars in order:</p>
            <ol className="list-decimal list-inside space-y-1 mt-1">
              <li>
                <code className="bg-muted px-1 rounded">GEMINI_API_KEY</code> — Google Gemini
                1.5 Flash (free: 1M tokens/day at{" "}
                <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="underline">
                  aistudio.google.com
                </a>
                )
              </li>
              <li>
                <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> — GitHub Copilot
                Chat API (uses your existing Copilot subscription)
              </li>
              <li>
                <code className="bg-muted px-1 rounded">GROQ_API_KEY</code> — Groq / Llama 3
                (free tier at{" "}
                <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="underline">
                  console.groq.com
                </a>
                )
              </li>
              <li>
                <span className="font-medium">OG / Schema fallback</span> — no key needed, reads
                meta tags & JSON-LD (works for most major platforms)
              </li>
            </ol>
          </div>
        </details>
      </div>
    </div>
  );
}
