"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, X, Share, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chrome's non-standard beforeinstallprompt event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ec-install-dismissed-at";
// Don't nag — once dismissed, stay quiet for two weeks.
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes navigator.standalone when launched from the home screen
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(max-width: 767px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
  );
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch points
  const iPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return iOS || iPadOS;
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * Mobile "Add to Home Screen" suggestion. On Android/Chrome it offers a one-tap
 * install via the captured beforeinstallprompt event; on iOS Safari (which has
 * no such API) it shows the manual Share → Add to Home Screen steps. Hidden on
 * desktop, when already installed, and for two weeks after a dismissal.
 */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    // Register the service worker (prod only — avoids interfering with dev HMR).
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort — install prompt still works via manual instructions */
      });
    }

    if (isStandalone() || !isMobile() || recentlyDismissed()) return;

    if (isIos()) {
      // iOS has no programmatic install — decide visibility on mount from the
      // platform check, so the synchronous setState here is intentional.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setIosMode(true);
      setVisible(true);
      return;
    }

    // Android/Chrome: wait for the browser to signal installability.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stash it so we control when to prompt
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Hide the prompt once the app gets installed.
    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* dismissal just won't persist if storage is blocked */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
    if (outcome === "dismissed") dismiss();
  }, [deferredPrompt, dismiss]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md rounded-xl border border-border",
        "bg-card/95 shadow-lg backdrop-blur md:hidden",
      )}
      role="dialog"
      aria-label="Install app"
    >
      <div className="flex items-start gap-3 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" aria-hidden className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Add Event Calendar to your home screen</p>
          {iosMode ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Tap
              <Share className="inline size-3.5" aria-label="the Share button" />
              then
              <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                <Plus className="size-3" /> Add to Home Screen
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Install the app for quick access and a full-screen experience.
            </p>
          )}

          {!iosMode && (
            <button
              onClick={install}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Download className="size-3.5" />
              Install app
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
