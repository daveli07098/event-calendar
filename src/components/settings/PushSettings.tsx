"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** `serviceWorker.ready` never resolves when no SW is registered (dev, failed registration). */
function swReady(timeoutMs = 3000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("The service worker is not active yet. Reload the page and try again.")),
        timeoutMs,
      ),
    ),
  ]);
}

export function PushSettings() {
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
    const reg = await swReady();
    setEnabled(!!(await reg.pushManager.getSubscription()));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with browser push state on mount
    void refresh()
      .catch(() => setError("Push is unavailable: the service worker is not active. Reload the page to retry."))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!VAPID_PUBLIC_KEY) throw new Error("Push is not configured on this server.");
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") throw new Error("Notification permission was not granted.");
      const reg = await swReady();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("Could not save the subscription.");
      setEnabled(true);
      setMessage("Push notifications enabled on this device.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const reg = await swReady();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
      setMessage("Push notifications disabled on this device.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Test failed.");
      setMessage(`Test sent to ${data.sent} device(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking push status...
        </p>
      ) : !supported ? (
        <p className="text-sm text-muted-foreground">
          Push notifications are not supported in this browser. On iPhone they work only after
          Add to Home Screen.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <Button variant="outline" onClick={disable} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <BellOff className="size-4" />}
              Disable on this device
            </Button>
          ) : (
            <Button onClick={enable} disabled={busy || permission === "denied"}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
              Enable on this device
            </Button>
          )}
          <Button variant="outline" onClick={sendTest} disabled={busy || !enabled}>
            <Send className="size-4" />
            Send test
          </Button>
        </div>
      )}
      {permission === "denied" && (
        <p className="text-sm text-destructive">
          Notifications are blocked. Allow them in your browser or system settings, then try again.
          <span className="mt-1 block text-xs text-muted-foreground">
            How to unblock: open your browser&apos;s site settings for this page and set Notifications to
            Allow. On iPhone, first Add to Home Screen, then enable notifications in Settings &gt;
            Notifications.
          </span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        iPhone: works only after Add to Home Screen.
      </p>
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
