import { describe, it, expect } from "vitest";
import { detectTimezoneFromUrl } from "@/lib/source-timezone";

describe("detectTimezoneFromUrl", () => {
  it("resolves livenationhip.co.jp (Japan, via TLD) to +09:00 — the exact reported case", () => {
    const eventDate = new Date("2026-07-31T12:00:00Z");
    const tz = detectTimezoneFromUrl("https://www.livenationhip.co.jp/some-show", eventDate);
    expect(tz).toBe("+09:00");

    // 2026-07-31 12:00 JST must convert to 2026-07-31T03:00:00Z, not 04:00Z
    // (the bug: 12:00 interpreted in the client's HKT +08:00 instead of the
    // venue's JST +09:00).
    const iso = `2026-07-31T12:00:00${tz}`;
    expect(new Date(iso).toISOString()).toBe("2026-07-31T03:00:00.000Z");
  });

  it("resolves a bare .jp domain with no Japan-specific domain-map entry, via TLD fallback", () => {
    expect(detectTimezoneFromUrl("https://example.jp/tickets/123")).toBe("+09:00");
  });

  // The original hardcoded 8-domain HK allowlist — must keep resolving to
  // +08:00 byte-for-byte after the rewrite.
  const legacyHktDomains = [
    "timable.com", "cityline.com", "hkticketing.com", "ticketmaster.com.hk",
    "urbtix.hk", "ticketflap.com", "klook.com", "kktix.com",
  ];
  it.each(legacyHktDomains)("resolves legacy HK domain %s to +08:00 unchanged", (domain) => {
    expect(detectTimezoneFromUrl(`https://www.${domain}/event/456`)).toBe("+08:00");
  });

  it("resolves a UTC+8 non-HK source (Taiwan) correctly via country detection, not the legacy list", () => {
    // ibon.com.tw is NOT in the legacy hardcoded list — this proves the
    // domain→country→IANA composition path, not coincidental overlap.
    expect(detectTimezoneFromUrl("https://www.ibon.com.tw/ticket/789")).toBe("+08:00");
  });

  it("resolves a UTC+8 non-HK source (Singapore) correctly via country detection", () => {
    expect(detectTimezoneFromUrl("https://www.sistic.com.sg/events/1")).toBe("+08:00");
  });

  // London is GMT+0 in January and BST (GMT+1) in July — a static offset table
  // would get one of these wrong; DST-aware Intl resolution must not.
  it("resolves a UK source to GMT+0 in January (winter, no DST)", () => {
    expect(detectTimezoneFromUrl("https://www.ticketmaster.co.uk/show/1", new Date("2026-01-15T12:00:00Z"))).toBe("+00:00");
  });

  it("resolves the same UK source to GMT+1 in July (summer, BST) — different offset than January", () => {
    expect(detectTimezoneFromUrl("https://www.ticketmaster.co.uk/show/1", new Date("2026-07-15T12:00:00Z"))).toBe("+01:00");
  });

  it("returns null for an unknown domain with no detectable country — caller falls back to tzOffsetMinutes", () => {
    expect(detectTimezoneFromUrl("https://www.some-random-ticket-site.com/event/1")).toBeNull();
  });

  it("returns null for an invalid URL", () => {
    expect(detectTimezoneFromUrl("not a url")).toBeNull();
  });
});
