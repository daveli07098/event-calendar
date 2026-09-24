import { describe, it, expect } from "vitest";
import { getFallbackSources } from "@/lib/discounts/fallback-sources";

describe("getFallbackSources", () => {
  it("maps fanatics.com (and www.) to the coupons.com fallback", () => {
    expect(getFallbackSources("fanatics.com")[0]?.url).toBe("https://www.coupons.com/coupon-codes/fanatics");
    expect(getFallbackSources("www.fanatics.com")[0]?.url).toBe("https://www.coupons.com/coupon-codes/fanatics");
  });

  it("maps adidas.com.hk / www.adidas.com.hk / adidas.com to the shopback adidas fallback", () => {
    for (const host of ["adidas.com.hk", "www.adidas.com.hk", "adidas.com", "www.adidas.com"]) {
      expect(getFallbackSources(host)[0]?.url).toBe("https://www.shopback.com.hk/adidas");
    }
  });

  it("maps hk.puma.com / puma.com to the shopback puma fallback", () => {
    expect(getFallbackSources("hk.puma.com")[0]?.url).toBe("https://www.shopback.com.hk/puma");
    expect(getFallbackSources("puma.com")[0]?.url).toBe("https://www.shopback.com.hk/puma");
  });

  it("maps www.puma.com (the corporate_redirect host) to the real hk.puma.com store, not the aggregator", () => {
    const sources = getFallbackSources("www.puma.com");
    expect(sources[0]?.url).toBe("https://hk.puma.com/");
  });

  it("is case-insensitive on hostname", () => {
    expect(getFallbackSources("WWW.Fanatics.COM")[0]?.url).toBe("https://www.coupons.com/coupon-codes/fanatics");
  });

  it("returns [] for a host with no configured fallback", () => {
    expect(getFallbackSources("example.com")).toEqual([]);
  });

  it("every configured fallback URL is a valid http(s) URL", () => {
    for (const host of ["fanatics.com", "adidas.com.hk", "hk.puma.com", "www.puma.com"]) {
      for (const source of getFallbackSources(host)) {
        const u = new URL(source.url);
        expect(["http:", "https:"]).toContain(u.protocol);
        expect(source.label.length).toBeGreaterThan(0);
        expect(source.note.length).toBeGreaterThan(0);
      }
    }
  });
});
