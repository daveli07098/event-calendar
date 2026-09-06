import { describe, it, expect } from "vitest";
import {
  normalizeVenueText,
  venueKeys,
  matchVenue,
  extractVenueText,
  isPlaceholderLocation,
  type VenueMatch,
} from "@/lib/venue-match";

// Snapshot of the live venue directory (names only, no aliases), used across the matching
// tests below.
function directory(): Array<{ id: string; name: string; aliases: string[] }> {
  return [
    { id: "axa", name: "AXA 安盛創夢館" },
    { id: "mom", name: "MOM Livehouse" },
    { id: "portal", name: "PORTAL" },
    { id: "tides", name: "TIDES" },
    { id: "asia-10-exhibit", name: "亞洲國際博覽館 10號展館" },
    { id: "asia-10", name: "亞洲國際博覽館 10號館" },
    { id: "asia-5", name: "亞洲國際博覽館 5號館" },
    { id: "asia-arena", name: "亞洲國際博覽館 ARENA" },
    { id: "kai-tak", name: "啟德體育園 主場館" },
    { id: "hk-coliseum", name: "香港體育館 (紅館)" },
    { id: "mac-fun", name: "麥花臣場館" },
  ].map((v) => ({ ...v, aliases: [] as string[] }));
}

describe("normalizeVenueText", () => {
  it("lowercases and folds fullwidth punctuation to ascii/space", () => {
    expect(normalizeVenueText("PORTAL")).toBe("portal");
    expect(normalizeVenueText("香港體育館（紅館）")).toBe("香港體育館紅館");
  });

  it("collapses whitespace between CJK characters but keeps it around latin/digits", () => {
    expect(normalizeVenueText("啟德體育園 主場館")).toBe("啟德體育園主場館");
    expect(normalizeVenueText("亞洲國際博覽館 10號館")).toBe("亞洲國際博覽館 10號館");
  });

  it("trims and returns empty string for blank input", () => {
    expect(normalizeVenueText("   ")).toBe("");
  });
});

describe("venueKeys", () => {
  it("includes the normalized name", () => {
    expect(venueKeys({ name: "PORTAL", aliases: [] })).toContain("portal");
  });

  it("includes aliases", () => {
    expect(venueKeys({ name: "啟德體育園", aliases: ["Kai Tak Stadium"] })).toContain("kai tak stadium");
  });

  it("derives the parenthesised nickname and the name without it", () => {
    const keys = venueKeys({ name: "香港體育館 (紅館)", aliases: [] });
    expect(keys).toContain("紅館");
    expect(keys).toContain("香港體育館");
  });
});

describe("matchVenue", () => {
  const venues = directory();

  it("matches '啟德體育園主場館, Hong Kong' to 啟德體育園 主場館 exactly", () => {
    const result = matchVenue("啟德體育園主場館, Hong Kong", venues);
    expect(result).toEqual<VenueMatch>({ venueId: "kai-tak", via: "exact" });
  });

  it("matches '紅館' to 香港體育館 via its parenthesised alias", () => {
    const result = matchVenue("紅館", venues);
    expect(result).toEqual<VenueMatch>({ venueId: "hk-coliseum", via: "alias" });
  });

  it("picks 亞洲國際博覽館 10號館 and not 10號展館 for an exact match", () => {
    const result = matchVenue("亞洲國際博覽館 10號館, 香港", venues);
    expect(result?.venueId).toBe("asia-10");
  });

  it("picks 亞洲國際博覽館 10號展館 and not 10號館 for the reverse text", () => {
    const result = matchVenue("亞洲國際博覽館 10號展館, 香港", venues);
    expect(result?.venueId).toBe("asia-10-exhibit");
  });

  it("does not match 'Kowloon Portal Plaza' against venue PORTAL", () => {
    expect(matchVenue("Kowloon Portal Plaza", venues)).toBeNull();
  });

  it("matches 'PORTAL, Hong Kong' to venue PORTAL", () => {
    const result = matchVenue("PORTAL, Hong Kong", venues);
    expect(result).toEqual<VenueMatch>({ venueId: "portal", via: "exact" });
  });

  it("does not match 'Kai Tak Stadium' when no venue/alias in the directory names it", () => {
    expect(matchVenue("Kai Tak Stadium", venues)).toBeNull();
  });

  it("matches 'Kai Tak Stadium' via alias when a directory entry declares it", () => {
    const withAlias = [{ id: "kai-tak-alt", name: "啟德體育園", aliases: ["Kai Tak Stadium"] }];
    const result = matchVenue("Kai Tak Stadium", withAlias);
    expect(result).toEqual<VenueMatch>({ venueId: "kai-tak-alt", via: "alias" });
  });

  it("returns null for null, undefined, or empty text", () => {
    expect(matchVenue(null, venues)).toBeNull();
    expect(matchVenue(undefined, venues)).toBeNull();
    expect(matchVenue("", venues)).toBeNull();
    expect(matchVenue("   ", venues)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchVenue("Some Random Hall", venues)).toBeNull();
  });
});

describe("extractVenueText", () => {
  it("prefers the 'Venue: ...' line from the description", () => {
    const text = extractVenueText({
      location: "Fallback Location",
      description: "Some details\nVenue: 啟德體育園主場館\nSeat: Level 5 Block 519B Row M Seat 547",
    });
    expect(text).toBe("啟德體育園主場館");
  });

  it("falls back to location when there is no Venue: line", () => {
    const text = extractVenueText({ location: "PORTAL, Hong Kong", description: "No venue line here" });
    expect(text).toBe("PORTAL, Hong Kong");
  });

  it("returns null when both are absent", () => {
    expect(extractVenueText({ location: null, description: null })).toBeNull();
  });
});

describe("isPlaceholderLocation", () => {
  it("flags a bare city/country name", () => {
    expect(isPlaceholderLocation("Hong Kong")).toBe(true);
  });

  it("flags a TBD-style placeholder", () => {
    expect(isPlaceholderLocation("TBD (Coming Soon)")).toBe(true);
  });

  it("flags empty/blank text", () => {
    expect(isPlaceholderLocation("")).toBe(true);
    expect(isPlaceholderLocation("   ")).toBe(true);
  });

  it("does not flag a real venue name that happens to include a place name", () => {
    expect(isPlaceholderLocation("啟德體藝館 Kai Tak Arena")).toBe(false);
    expect(isPlaceholderLocation("SM Mall of Asia")).toBe(false);
  });
});
