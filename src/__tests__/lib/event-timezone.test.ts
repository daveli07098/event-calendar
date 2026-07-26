import { describe, it, expect } from "vitest";
import { venueTimeZone, describeVenueTime } from "@/lib/event-timezone";

describe("venueTimeZone", () => {
  it("resolves an unambiguous tag to its IANA zone", () => {
    expect(venueTimeZone({ title: "Concert", location: "Tokyo Dome, Japan" })).toBe("Asia/Tokyo");
  });

  it("returns null for an ambiguous multi-zone country (United States)", () => {
    expect(venueTimeZone({ title: "Show", location: "New York, USA" })).toBeNull();
  });

  it("returns null when no location tag is detected", () => {
    expect(venueTimeZone({ title: "Team sync", location: null })).toBeNull();
  });
});

describe("describeVenueTime", () => {
  it("shows a secondary line for an unambiguous venue in a different zone", () => {
    // 10:00 UTC = 19:00 JST (Tokyo, GMT+9) = 18:00 HKT (Hong Kong, GMT+8)
    const info = describeVenueTime(
      "2026-09-12T10:00:00Z",
      { title: "Concert", location: "Tokyo, Japan" },
      "Asia/Hong_Kong",
    );
    expect(info.primaryTime).toBe("18:00");
    expect(info.secondaryTime).toBe("19:00");
  });

  it("omits the secondary line for same-offset zones (HK viewer, Singapore venue)", () => {
    const info = describeVenueTime(
      "2026-09-12T10:00:00Z",
      { title: "Concert", location: "Singapore" },
      "Asia/Hong_Kong",
    );
    expect(info.secondaryTime).toBeNull();
  });

  it("omits the secondary line for an ambiguous country (United States)", () => {
    const info = describeVenueTime(
      "2026-09-12T10:00:00Z",
      { title: "Show", location: "New York, USA" },
      "Asia/Hong_Kong",
    );
    expect(info.secondaryTime).toBeNull();
  });

  it("omits the secondary line when no location tag is detectable", () => {
    const info = describeVenueTime(
      "2026-09-12T10:00:00Z",
      { title: "Team sync", location: null },
      "Asia/Hong_Kong",
    );
    expect(info.secondaryTime).toBeNull();
  });

  // London is GMT+0 in January and BST (GMT+1) in July. Naive fixed-offset math
  // would get one of these wrong — real Intl/timezone formatting must not.
  it("accounts for DST correctly for a European venue viewed from Hong Kong (January, GMT)", () => {
    // 19:00 GMT (London, winter) = 2026-01-15T19:00:00Z = 03:00 HKT next day (GMT+8)
    const info = describeVenueTime(
      "2026-01-15T19:00:00Z",
      { title: "Show", location: "London, UK" },
      "Asia/Hong_Kong",
    );
    expect(info.secondaryTime).toBe("19:00");
    expect(info.primaryTime).toBe("03:00");
  });

  it("accounts for DST correctly for a European venue viewed from Hong Kong (July, BST)", () => {
    // 19:00 BST (London, summer, GMT+1) = 2026-07-15T18:00:00Z = 02:00 HKT next day (GMT+8)
    const info = describeVenueTime(
      "2026-07-15T18:00:00Z",
      { title: "Show", location: "London, UK" },
      "Asia/Hong_Kong",
    );
    expect(info.secondaryTime).toBe("19:00");
    expect(info.primaryTime).toBe("02:00");
  });
});
