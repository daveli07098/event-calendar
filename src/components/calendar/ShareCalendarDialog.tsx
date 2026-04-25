"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Copy, Check, Link2, X } from "lucide-react";
import Image from "next/image";
import type { CalendarType, CalendarMemberType } from "@/types";

interface ShareCalendarDialogProps {
  calendar: CalendarType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void; // refetch calendars from parent
}

type ShareMode = "collaborative" | "broadcast";

export function ShareCalendarDialog({
  calendar,
  open,
  onOpenChange,
  onUpdated,
}: ShareCalendarDialogProps) {
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<CalendarMemberType[]>([]);

  // Derive current state from calendar prop
  const currentMode = calendar?.shareMode ?? null;
  const shareUrl =
    calendar?.shareToken
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${calendar.shareToken}`
      : null;

  useEffect(() => {
    if (open && calendar?.members) {
      setMembers(calendar.members);
    }
  }, [open, calendar]);

  const enableSharing = async (mode: ShareMode) => {
    if (!calendar) return;
    setSaving(true);
    const res = await fetch(`/api/calendars/${calendar.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) onUpdated();
    setSaving(false);
  };

  const disableSharing = async () => {
    if (!calendar) return;
    setSaving(true);
    const res = await fetch(`/api/calendars/${calendar.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: null }),
    });
    if (res.ok) {
      setMembers([]);
      onUpdated();
    }
    setSaving(false);
  };

  const removeMember = async (userId: string) => {
    if (!calendar) return;
    await fetch(`/api/calendars/${calendar.id}/members/${userId}`, {
      method: "DELETE",
    });
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    onUpdated();
  };

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!calendar) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold leading-tight">
            <span
              className="size-3.5 rounded-full shrink-0"
              style={{ backgroundColor: calendar.color }}
            />
            <span className="truncate">Share &ldquo;{calendar.name}&rdquo;</span>
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Choose how others can access this calendar.
          </DialogDescription>
        </div>

        {/* Body — scrollable if content grows */}
        <div className="px-6 pb-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => enableSharing("collaborative")}
              disabled={saving || currentMode === "collaborative"}
              title={currentMode === "collaborative" ? "Already collaborative" : undefined}
              className={`rounded-lg border p-3.5 text-left text-sm transition-colors ${
                currentMode === "collaborative"
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <p className="font-semibold mb-1">Collaborative</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Anyone with link can add &amp; edit events
              </p>
              {currentMode === "broadcast" && (
                <p className="text-[10px] text-primary mt-1.5 font-medium">Viewers promoted to editors</p>
              )}
            </button>
            <button
              onClick={() => enableSharing("broadcast")}
              disabled={saving || currentMode === "collaborative"}
              title={currentMode === "collaborative" ? "Cannot downgrade — stop sharing first" : undefined}
              className={`rounded-lg border p-3.5 text-left text-sm transition-colors ${
                currentMode === "collaborative"
                  ? "border-border opacity-40 cursor-not-allowed"
                  : currentMode === "broadcast"
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <p className="font-semibold mb-1">Broadcast</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Anyone with link can only view events
              </p>
              {currentMode === "collaborative" && (
                <p className="text-[10px] text-muted-foreground mt-1.5">Stop sharing to enable</p>
              )}
            </button>
          </div>

          {/* Invite link */}
          {currentMode && shareUrl ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Invite link
              </p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
                <Link2 className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-xs truncate font-mono">{shareUrl}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  onClick={copyLink}
                >
                  {copied ? (
                    <Check className="size-3.5 text-green-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/10 w-full"
                onClick={disableSharing}
                disabled={saving}
              >
                Stop sharing
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-1">
              Select a mode above to generate the invite link.
            </p>
          )}

          {/* Member list */}
          {members.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Members ({members.length})
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    {m.user?.image ? (
                      <Image
                        src={m.user.image}
                        alt=""
                        width={24}
                        height={24}
                        className="rounded-full shrink-0"
                      />
                    ) : (
                      <div className="size-6 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {m.user?.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {m.user?.name ?? m.user?.email ?? "Unknown"}
                      </p>
                      <p className="text-[10px] text-muted-foreground capitalize">{m.role}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMember(m.userId)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
