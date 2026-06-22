"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useSession, signIn } from "next-auth/react";
import { Link2Off, CheckCircle2, Loader2 } from "lucide-react";

interface CalendarPreview {
  id: string;
  name: string;
  color: string;
  shareMode: "collaborative" | "broadcast";
  owner: { name: string | null; image: string | null };
}

interface JoinClientProps {
  token: string;
  preview: CalendarPreview | null;
  error?: string;
}

export function JoinClient({ token, preview, error }: JoinClientProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  if (error || !preview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
            <Link2Off className="size-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Invite link not found</h1>
          <p className="text-muted-foreground text-sm mb-6">
            This link may have expired or been revoked.
          </p>
          <Button onClick={() => router.push("/")} variant="outline">
            Go to Calendar
          </Button>
        </div>
      </div>
    );
  }

  const handleJoin = async () => {
    if (status !== "authenticated") {
      // Redirect to login then back to this page
      signIn(undefined, { callbackUrl: `/join/${token}` });
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/join/${token}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error ?? "Failed to join calendar");
      } else {
        setJoined(true);
        setTimeout(() => router.push("/"), 2000);
      }
    } catch {
      setJoinError("Network error, please try again");
    } finally {
      setJoining(false);
    }
  };

  const modeLabel =
    preview.shareMode === "collaborative"
      ? "Collaborative — you can add and edit events"
      : "Broadcast — view only";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-lg p-8 flex flex-col items-center gap-5 duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
        {/* Calendar color circle */}
        <div
          className="size-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow"
          style={{ backgroundColor: preview.color }}
        >
          {preview.name[0]?.toUpperCase()}
        </div>

        <div className="text-center">
          <h1 className="text-xl font-semibold">{preview.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{modeLabel}</p>
        </div>

        {/* Owner */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {preview.owner.image ? (
            <Image
              src={preview.owner.image}
              alt=""
              width={24}
              height={24}
              className="rounded-full"
            />
          ) : (
            <div className="size-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
              {preview.owner.name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <span>Shared by {preview.owner.name ?? "Unknown"}</span>
        </div>

        {joined ? (
          <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Joined! Redirecting…
          </div>
        ) : (
          <>
            {joinError && (
              <p className="text-sm text-destructive text-center">{joinError}</p>
            )}
            <Button
              className="w-full"
              onClick={handleJoin}
              disabled={joining || status === "loading"}
            >
              {(status === "loading" || joining) && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              {status === "loading"
                ? "Loading…"
                : status !== "authenticated"
                ? "Sign in to join"
                : joining
                ? "Joining…"
                : "Join calendar"}
            </Button>
            {status !== "authenticated" && (
              <p className="text-xs text-muted-foreground text-center">
                You&apos;ll be asked to sign in first
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
