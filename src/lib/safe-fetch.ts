/**
 * SSRF-safe fetch wrapper.
 *
 * Any route that fetches a URL supplied (directly or indirectly) by a user
 * must go through `safeFetch` / `assertPublicUrl` instead of the bare global
 * `fetch`. This closes the gaps in the old per-route hostname-prefix checks:
 *
 *   - actually resolves DNS and validates every returned address (blocks
 *     "DNS rebinding" — a public-looking hostname that resolves to a
 *     private/internal IP)
 *   - covers IPv6 (loopback ::1, link-local fe80::/10, unique-local fc00::/7,
 *     IPv4-mapped ::ffff:a.b.c.d) in addition to IPv4
 *   - uses a real 172.16.0.0/12 range check instead of a naive "172." prefix
 *     match (172.32.x.x is public and must NOT be blocked)
 *   - adds the 169.254.0.0/16 link-local range (cloud metadata endpoints
 *     such as 169.254.169.254 live here) and 100.64.0.0/10 (CGNAT)
 *   - follows redirects manually and re-validates every hop, so an allowed
 *     URL can't 302 straight into an internal address
 *   - caps the response body size so a huge response can't exhaust memory
 *
 * Not proxy-aware: this module resolves hostnames locally via
 * `dns.promises.lookup` and fetches with Node's built-in global `fetch`.
 * The AI-provider client (`src/lib/ai/client.ts`) routes model calls through
 * an optional forward proxy (AI_PROXY_URL / HTTPS_PROXY / ALL_PROXY) using
 * undici's `ProxyAgent`; the three page-scraping routes that use this module
 * (tickets/refix, tickets/scrape, discounts/scan) do NOT use that proxy path
 * — they fetch third-party pages directly with the global fetch — so local
 * DNS resolution is the correct check for them.
 */
import dns from "node:dns";
import net from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message = "Private URLs are not allowed") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal"];
const BLOCKED_HOSTNAMES = new Set(["localhost"]);

export interface SafeFetchOptions extends RequestInit {
  /** Max number of redirect hops to follow before giving up. Default 5. */
  maxRedirects?: number;
  /** Max response body size in bytes. Default 5 MB. */
  maxBytes?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// IPv4 range checks
// ---------------------------------------------------------------------------
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0);
}

function ipv4InRange(ip: string, base: string, prefixBits: number): boolean {
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** True if the address is loopback / private / link-local / reserved / multicast. */
function isPrivateIPv4(ip: string): boolean {
  return (
    ipv4InRange(ip, "0.0.0.0", 8) ||       // "this network" / unspecified
    ipv4InRange(ip, "10.0.0.0", 8) ||       // RFC1918
    ipv4InRange(ip, "100.64.0.0", 10) ||    // CGNAT (RFC6598)
    ipv4InRange(ip, "127.0.0.0", 8) ||      // loopback
    ipv4InRange(ip, "169.254.0.0", 16) ||   // link-local incl. cloud metadata (169.254.169.254)
    ipv4InRange(ip, "172.16.0.0", 12) ||    // RFC1918 (172.16.0.0 – 172.31.255.255 ONLY)
    ipv4InRange(ip, "192.168.0.0", 16) ||   // RFC1918
    ipv4InRange(ip, "224.0.0.0", 4) ||      // multicast
    ipv4InRange(ip, "240.0.0.0", 4)         // reserved / broadcast
  );
}

// ---------------------------------------------------------------------------
// IPv6 range checks
// ---------------------------------------------------------------------------
/** Expand a valid IPv6 literal (optionally with an embedded IPv4 tail) to a 128-bit BigInt. */
function ipv6ToBigInt(address: string): bigint | null {
  const addr = address.toLowerCase().split("%")[0]!; // strip zone id, e.g. fe80::1%eth0
  if (!net.isIPv6(addr)) return null;

  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  let head = addr;
  let v4Groups: string[] = [];
  if (tail.includes(".")) {
    if (!net.isIPv4(tail)) return null;
    const octets = tail.split(".").map(Number);
    v4Groups = [
      (((octets[0]! << 8) | octets[1]!) >>> 0).toString(16),
      (((octets[2]! << 8) | octets[3]!) >>> 0).toString(16),
    ];
    head = addr.slice(0, lastColon);
  }

  let left: string[];
  let right: string[];
  if (head.includes("::")) {
    const parts = head.split("::");
    left = parts[0] ? parts[0]!.split(":").filter(Boolean) : [];
    right = parts[1] ? parts[1]!.split(":").filter(Boolean) : [];
  } else {
    left = head.split(":").filter(Boolean);
    right = [];
  }

  const missing = 8 - (left.length + right.length + v4Groups.length);
  if (missing < 0) return null;
  const fullGroups = [...left, ...Array(missing).fill("0"), ...right, ...v4Groups];
  if (fullGroups.length !== 8) return null;

  let result = BigInt(0);
  for (const g of fullGroups) {
    result = (result << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return result;
}

/** True if the address is loopback / unique-local / link-local / multicast / an IPv4-mapped private address. */
function isPrivateIPv6(ip: string): boolean {
  const addr = ipv6ToBigInt(ip);
  if (addr === null) return true; // unparsable — fail closed

  if (addr === BigInt(0)) return true; // :: (unspecified)
  if (addr === BigInt(1)) return true; // ::1 (loopback)

  const top8 = addr >> BigInt(120);
  const top7 = addr >> BigInt(121);
  const top10 = addr >> BigInt(118);
  if (top8 === BigInt(0xff)) return true;   // ff00::/8 multicast
  if (top7 === BigInt(0x7e)) return true;   // fc00::/7 unique-local
  if (top10 === BigInt(0x3fa)) return true; // fe80::/10 link-local

  // ::ffff:0:0/96 — IPv4-mapped IPv6: apply the same rules to the embedded IPv4.
  const top96 = addr >> BigInt(32);
  if (top96 === BigInt(0xffff)) {
    const v4Int = Number(addr & BigInt(0xffffffff));
    const v4 = [
      (v4Int >>> 24) & 0xff,
      (v4Int >>> 16) & 0xff,
      (v4Int >>> 8) & 0xff,
      v4Int & 0xff,
    ].join(".");
    return isPrivateIPv4(v4);
  }

  return false;
}

/** True if a raw address string (v4 or v6) is private/loopback/link-local/reserved. */
function isPrivateAddress(address: string, family: 4 | 6): boolean {
  return family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

// ---------------------------------------------------------------------------
// URL / hostname validation
// ---------------------------------------------------------------------------
function parseAndCheckProtocol(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UnsafeUrlError("Invalid URL");
  }
  return parsed;
}

/** Strip the `[...]` brackets the WHATWG URL parser puts around IPv6 hostnames. */
function bareHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Validate that `urlStr` is a well-formed http(s) URL whose hostname does not
 * resolve to any private/loopback/link-local/reserved address. Throws
 * `UnsafeUrlError` otherwise. Resolves the parsed `URL` on success.
 */
export async function assertPublicUrl(urlStr: string): Promise<URL> {
  const parsed = parseAndCheckProtocol(urlStr);
  const hostname = bareHostname(parsed.hostname.toLowerCase());

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new UnsafeUrlError();
  }

  // Literal IP in the URL itself (v4 or v6) — validate directly, no DNS involved.
  const literalFamily = net.isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (isPrivateAddress(hostname, literalFamily as 4 | 6)) throw new UnsafeUrlError();
    return parsed;
  }

  // Hostname — resolve every address it maps to and reject if ANY is private.
  // This is what blocks DNS-rebinding (a public-looking name pointed at an
  // internal IP).
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("Could not resolve host");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("Could not resolve host");
  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family as 4 | 6)) throw new UnsafeUrlError();
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Capped body read
// ---------------------------------------------------------------------------
async function readCapped(res: Response, maxBytes: number): Promise<Response> {
  if (!res.body) return res;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UnsafeUrlError(`Response exceeded ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * SSRF-safe drop-in replacement for `fetch`. Validates the URL (and every
 * redirect hop) against `assertPublicUrl`, follows redirects manually up to
 * `maxRedirects`, and caps the response body at `maxBytes`.
 *
 * All other init options (headers, signal/timeout, cache, ...) are passed
 * through unchanged — callers keep their existing timeout/UA/cache behavior.
 */
export async function safeFetch(input: string, init: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = DEFAULT_MAX_REDIRECTS, maxBytes = DEFAULT_MAX_BYTES, ...fetchInit } = init;

  let currentUrl = input;
  for (let hop = 0; ; hop++) {
    if (hop > maxRedirects) throw new UnsafeUrlError("Too many redirects");

    await assertPublicUrl(currentUrl);
    const res = await fetch(currentUrl, { ...fetchInit, redirect: "manual" });

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      if (!location) return res;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return readCapped(res, maxBytes);
  }
}
