import { describe, it, expect } from "vitest";
import {
  buildBookmarklet,
  BOOKMARKLET_HTML_MAX_CHARS,
  PAGE_MESSAGE_TYPE,
  READY_MESSAGE_TYPE,
} from "@/lib/discounts/bookmarklet";

const APP_ORIGIN = "https://calendar.example.com";

describe("buildBookmarklet", () => {
  it("is a javascript: URL", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    expect(href.startsWith("javascript:")).toBe(true);
  });

  it("contains the app origin so the popup opens back at this app", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    // encodeURI leaves scheme/host/port characters (":", "/", letters,
    // digits) unescaped — the origin must survive verbatim in the href. The
    // popup URL itself is built at runtime as `APP + '/tickets?...'`, so the
    // origin and the path template are checked separately rather than as
    // one concatenated literal.
    expect(href).toContain(APP_ORIGIN);
    expect(href).toContain("/tickets?section=discounts&receive=1");
  });

  it("differs for a different app origin — it isn't hardcoded", () => {
    const a = buildBookmarklet("https://one.example.com");
    const b = buildBookmarklet("https://two.example.com");
    expect(a).not.toBe(b);
    expect(a).toContain("https://one.example.com");
    expect(b).toContain("https://two.example.com");
  });

  it("loads no external script — the whole bookmarklet is self-contained", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).not.toMatch(/<script/i);
    expect(decoded).not.toMatch(/\bsrc\s*=/i);
    expect(decoded).not.toMatch(/document\.createElement\(['"]script['"]\)/);
  });

  it("references the shared message-type constants used by the receiver", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain(READY_MESSAGE_TYPE);
    expect(decoded).toContain(PAGE_MESSAGE_TYPE);
  });

  it("caps the HTML it would send under the receiver's paste-content limit", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain(String(BOOKMARKLET_HTML_MAX_CHARS));
    expect(BOOKMARKLET_HTML_MAX_CHARS).toBeLessThan(400_000);
  });

  it("decodes to syntactically valid, executable JavaScript", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    // Would throw a SyntaxError if the collapse-to-one-line step (or a stray
    // `//`/unescaped quote in the generator) ever mangled the source.
    expect(() => new Function(decoded)).not.toThrow();
  });

  it("collapses to a single line (no newlines to swallow a line comment)", () => {
    const href = buildBookmarklet(APP_ORIGIN);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    // Not asserting an absence of "//" here — the app origin itself
    // (https://...) legitimately contains it. new Function(decoded) above
    // is the real guard: a stray line comment would swallow the rest of the
    // script and fail to parse/behave once collapsed.
    expect(decoded).not.toContain("\n");
  });
});
