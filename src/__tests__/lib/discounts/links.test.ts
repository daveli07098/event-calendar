import { describe, it, expect } from "vitest";
import {
  extractLinksFromHtml,
  selectDiscountCandidates,
  matchItemLink,
} from "@/lib/discounts/links";

const BASE = "https://marathonsports.hkstore.com/page";

// A stand-in retail page: a <nav> promo menu (kept — unlike the text
// extractor, which strips <nav>), one external cross-sell link, a duplicate
// href with different anchor text, and assorted junk hrefs that must be
// dropped.
const HTML = `
<html><body>
<nav>
  <a href="/clearance">清貨特價</a>
  <a href="/members">會員專區</a>
</nav>
<a href="/sale?cat=shoes">Sale</a>
<a href="#top">Back to top</a>
<a href="javascript:void(0)">Click</a>
<a href="mailto:test@example.com">Email us</a>
<a href="https://other.com/deal">外部優惠</a>
<a href="/clearance">清貨特價二</a>
<a href="/promo-code">Check This Out</a>
<a href="/save">Save 20% &amp; more</a>
<a href="/collections/promo">全場8折</a>
<a href="/products/hoka-hopara-2-womens">Hoka Hopara 2 女裝涼鞋</a>
<a href="/about">About Us</a>
</body></html>
`;

describe("extractLinksFromHtml", () => {
  const links = extractLinksFromHtml(HTML, BASE);

  it("resolves relative hrefs against the base URL", () => {
    const clearance = links.find((l) => l.href === "https://marathonsports.hkstore.com/clearance");
    expect(clearance).toBeDefined();
  });

  it("keeps nav links — they carry the promo menu", () => {
    expect(links.some((l) => l.href === "https://marathonsports.hkstore.com/members")).toBe(true);
  });

  it("dedupes by href, keeping the first non-empty text", () => {
    const matches = links.filter((l) => l.href === "https://marathonsports.hkstore.com/clearance");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("清貨特價");
  });

  it("drops fragment-only, javascript:, and mailto: hrefs", () => {
    expect(links.some((l) => l.href.includes("#top"))).toBe(false);
    expect(links.some((l) => l.href.startsWith("javascript:"))).toBe(false);
    expect(links.some((l) => l.href.startsWith("mailto:"))).toBe(false);
  });

  it("decodes HTML entities in anchor text", () => {
    const save = links.find((l) => l.href === "https://marathonsports.hkstore.com/save");
    expect(save?.text).toBe("Save 20% & more");
  });

  it("keeps cross-origin links", () => {
    expect(links.some((l) => l.href === "https://other.com/deal")).toBe(true);
  });
});

describe("selectDiscountCandidates", () => {
  const links = extractLinksFromHtml(HTML, BASE);
  const candidates = selectDiscountCandidates(links, BASE);
  const hrefs = candidates.map((l) => l.href);

  it("matches on Chinese discount keywords in link text (清貨, 優惠)", () => {
    expect(hrefs).toContain("https://marathonsports.hkstore.com/clearance");
    expect(hrefs).toContain("https://other.com/deal");
  });

  it("matches on English discount keywords in link text (sale, save)", () => {
    expect(hrefs).toContain("https://marathonsports.hkstore.com/sale?cat=shoes");
    expect(hrefs).toContain("https://marathonsports.hkstore.com/save");
  });

  it("matches on the URL path+query when the text itself has no keyword", () => {
    expect(hrefs).toContain("https://marathonsports.hkstore.com/promo-code");
  });

  it("matches on the 折 keyword in link text", () => {
    expect(hrefs).toContain("https://marathonsports.hkstore.com/collections/promo");
  });

  it("excludes links with no keyword match in text or URL", () => {
    expect(hrefs).not.toContain("https://marathonsports.hkstore.com/members");
    expect(hrefs).not.toContain("https://marathonsports.hkstore.com/about");
    expect(hrefs).not.toContain("https://marathonsports.hkstore.com/products/hoka-hopara-2-womens");
  });

  it("orders same-origin candidates before other-origin candidates", () => {
    const otherIdx = hrefs.indexOf("https://other.com/deal");
    const sameOriginIdxs = hrefs
      .map((h, i) => (h.startsWith("https://marathonsports.hkstore.com") ? i : -1))
      .filter((i) => i >= 0);
    expect(otherIdx).toBeGreaterThan(Math.max(...sameOriginIdxs));
  });

  it("caps the result at `max`", () => {
    expect(selectDiscountCandidates(links, BASE, 2)).toHaveLength(2);
  });
});

describe("matchItemLink", () => {
  const links = extractLinksFromHtml(HTML, BASE);

  it("matches an item name to its product link", () => {
    const href = matchItemLink("Hoka Hopara 2 女裝涼鞋", links);
    expect(href).toBe("https://marathonsports.hkstore.com/products/hoka-hopara-2-womens");
  });

  it("returns null when nothing matches", () => {
    expect(matchItemLink("Completely Unrelated Product Name", links)).toBeNull();
  });

  // Regression: a bare brand-page link ("Adidas") must not be treated as a
  // match for a specific product just because "Adidas" is a substring of the
  // item name — that mis-linked "Adidas Adilette Comfort 2.0 Argentina
  // Slides 中性拖鞋" to the generic /brands/adidas page.
  it("rejects a short, single-word brand anchor even though it's a substring of the item name", () => {
    const brandOnly = [{ href: "https://marathonsports.hkstore.com/brands/adidas", text: "Adidas" }];
    expect(
      matchItemLink("Adidas Adilette Comfort 2.0 Argentina Slides 中性拖鞋", brandOnly)
    ).toBeNull();
  });

  it("still matches an exact full-name anchor", () => {
    const exact = [{ href: "https://marathonsports.hkstore.com/products/hoka-hopara-2-womens", text: "Hoka Hopara 2 女裝涼鞋" }];
    expect(matchItemLink("Hoka Hopara 2 女裝涼鞋", exact)).toBe(
      "https://marathonsports.hkstore.com/products/hoka-hopara-2-womens"
    );
  });

  it("matches a longer, product-specific anchor (≥12 chars) even though it's shorter than the full item name", () => {
    const productSpecific = [
      { href: "https://marathonsports.hkstore.com/products/adidas-adilette-comfort", text: "Adidas Adilette Comfort 2.0" },
    ];
    expect(
      matchItemLink("Adidas Adilette Comfort 2.0 Argentina Slides 中性拖鞋", productSpecific)
    ).toBe("https://marathonsports.hkstore.com/products/adidas-adilette-comfort");
  });
});
