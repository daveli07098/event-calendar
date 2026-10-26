import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import type { PushPayload } from "@/lib/push-reminders";

let configured = false;

/** True when VAPID keys are present; configures web-push on first use. */
export function pushConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:dave22dave22@gmail.com", pub, priv);
  configured = true;
  return true;
}

/** Only real browser push services; the dispatcher POSTs to these URLs server-side (SSRF guard). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com")
  );
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one notification; prunes the subscription when the push service says it is gone. */
export async function sendPush(
  sub: PushTarget,
  payload: Pick<PushPayload, "title" | "body" | "url"> & Partial<PushPayload>,
): Promise<"sent" | "gone" | "failed"> {
  if (!pushConfigured()) return "failed";
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
      return "gone";
    }
    console.error("[push] send failed", status ?? (err as Error).message);
    return "failed";
  }
}
