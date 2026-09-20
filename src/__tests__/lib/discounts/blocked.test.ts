import { describe, it, expect } from "vitest";
import { detectBlockReason } from "@/lib/discounts/blocked";

describe("detectBlockReason", () => {
  it("flags a 403 as bot_protected regardless of body", () => {
    expect(detectBlockReason(403, "<html></html>", "https://www.adidas.com/x", "https://www.adidas.com/x")).toBe(
      "bot_protected"
    );
  });

  it("flags a 429 as bot_protected", () => {
    expect(detectBlockReason(429, "", "https://x.com/y", "https://x.com/y")).toBe("bot_protected");
  });

  it("flags a 200 sub-8KB Akamai sensor stub as bot_protected (spoofed-headers case)", () => {
    // Real shape: adding full Chrome sec-ch-ua/sec-fetch-* headers flips the
    // status to 200 but the body is still the block page, just smaller.
    const stub = `<html><body><script>var akamai={"page_owner":"AKAMAI","bm_so":"1"};</script></body></html>`;
    expect(detectBlockReason(200, stub, "https://www.adidas.com/x", "https://www.adidas.com/x")).toBe(
      "bot_protected"
    );
  });

  it("does NOT flag a large page that happens to contain 'Access Denied' as bot_protected", () => {
    const big = `<html><body>${"Access Denied to certain content categories. ".repeat(400)}</body></html>`;
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(8 * 1024);
    expect(detectBlockReason(200, big, "https://example.com/blog", "https://example.com/blog")).toBeNull();
  });

  it("flags a small 200 body containing customdeny as bot_protected", () => {
    const stub = `<html><body>redirecting to /_es_/fo/customdeny/</body></html>`;
    expect(detectBlockReason(200, stub, "https://www.fanatics.com/x", "https://www.fanatics.com/x")).toBe(
      "bot_protected"
    );
  });

  it("flags a corporate-site redirect (www.puma.com -> about.puma.com)", () => {
    expect(
      detectBlockReason(200, "<html><body>Investor relations</body></html>", "https://about.puma.com/en", "https://www.puma.com/hk/en/")
    ).toBe("corporate_redirect");
  });

  it("does NOT flag a same-host 200 with real content", () => {
    const page = `<html><body>${"Up to 50% off select styles. ".repeat(50)}</body></html>`;
    expect(detectBlockReason(200, page, "https://www.nike.com/sale", "https://www.nike.com/sale")).toBeNull();
  });

  it("does NOT flag a redirect to a same-brand regional subdomain that isn't about./corporate.", () => {
    expect(
      detectBlockReason(200, "<html><body>Shop now</body></html>", "https://hk.puma.com/en/", "https://www.puma.com/hk/en/")
    ).toBeNull();
  });
});
