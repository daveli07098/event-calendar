import { describe, it, expect } from "vitest";
import { extractEmbeddedPromoLines, formatEmbeddedPromoBlock, EMBEDDED_PROMO_HEADING } from "@/lib/discounts/embedded";

// Trimmed real-shape 91app/NineYi storefront bootstrap — the actual shape
// found on hk.puma.com: a `topMessageData.text` banner string sitting inside
// a larger inline-script JSON blob that extractTextFromHtml strips wholesale.
const NINEYI_BOOTSTRAP_HTML = `
<html><head>
<script>
window.__NINEYI_STORE__ = {"shopId":76,"topMessageData":{"text":"🍂AUTUMN SPECIAL! 3件6折 | 滿$1500減$200","enabled":true,"bgColor":"#000"},"footerLinks":["About us","Contact","Shipping"],"nav":["Men","Women","Kids","New Arrivals"]};
</script>
</head><body><p>PUMA</p></body></html>
`;

// A Next.js __NEXT_DATA__ blob with the promo buried a couple of levels deep
// in pageProps, alongside plenty of non-promo strings (nav labels, SKUs).
const NEXT_DATA_HTML = `
<html><body>
<div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"banner":{"headline":"低至3折 全場清貨","sku":"ABC-123-XL","navLabel":"Shop Now"},"products":[{"name":"Running Shoe A","sku":"RS-001"},{"name":"Running Shoe B","sku":"RS-002"}]}},"page":"/"}</script>
</body></html>
`;

describe("extractEmbeddedPromoLines", () => {
  it("finds a topMessageData.text banner buried in an inline script (91app/NineYi shape)", () => {
    const lines = extractEmbeddedPromoLines(NINEYI_BOOTSTRAP_HTML);
    expect(lines).toContain("🍂AUTUMN SPECIAL! 3件6折 | 滿$1500減$200");
  });

  it("does not pick up unrelated flat strings from the same blob (footer/nav labels)", () => {
    const lines = extractEmbeddedPromoLines(NINEYI_BOOTSTRAP_HTML);
    expect(lines.some((l) => l.includes("Contact"))).toBe(false);
    expect(lines.some((l) => l.includes("New Arrivals"))).toBe(false);
  });

  it("finds a promo string nested inside a __NEXT_DATA__ blob", () => {
    const lines = extractEmbeddedPromoLines(NEXT_DATA_HTML);
    expect(lines).toContain("低至3折 全場清貨");
  });

  it("does not pick up plain product names/SKUs from the same __NEXT_DATA__ blob", () => {
    const lines = extractEmbeddedPromoLines(NEXT_DATA_HTML);
    expect(lines.some((l) => l.includes("Running Shoe"))).toBe(false);
    expect(lines.some((l) => l.includes("RS-001"))).toBe(false);
    expect(lines.some((l) => l.includes("ABC-123-XL"))).toBe(false);
  });

  it("returns [] for a page with no inline scripts at all", () => {
    expect(extractEmbeddedPromoLines("<html><body><p>Nothing here</p></body></html>")).toEqual([]);
  });

  it("ignores external scripts (src=, no inline body)", () => {
    const html = `<html><head><script src="https://cdn.example.com/app.js"></script></head><body></body></html>`;
    expect(extractEmbeddedPromoLines(html)).toEqual([]);
  });

  it("decodes JSON escapes (\\uXXXX, emoji surrogate pairs) in the matched text", () => {
    const html = `<html><body><script>var x={"promotion":"Save up to 50\\u0025 \\uD83C\\uDF82 today only"};</script></body></html>`;
    const lines = extractEmbeddedPromoLines(html);
    expect(lines).toContain("Save up to 50% \u{1F382} today only");
  });

  it("dedupes an identical promo string appearing in more than one script", () => {
    const html = `
      <script>var a={"promotion":"低至5折"};</script>
      <script>var b={"promotion":"低至5折"};</script>
    `;
    const lines = extractEmbeddedPromoLines(html);
    expect(lines.filter((l) => l === "低至5折")).toHaveLength(1);
  });

  it("noise rejection: a script with thousands of plain product-name strings yields no non-promo lines and stays capped", () => {
    const products = Array.from({ length: 5000 }, (_, i) => `"Product Name Number ${i} Standard Edition"`).join(",");
    const html = `<html><body><script>var catalog=[${products},"低至2折 精選貨品"];</script></body></html>`;
    const lines = extractEmbeddedPromoLines(html);
    // The one genuine promo string survives...
    expect(lines).toContain("低至2折 精選貨品");
    // ...but nothing else from the 5000 plain product names leaked through.
    expect(lines.every((l) => l === "低至2折 精選貨品")).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(60);
  });

  it("rejects a double-JSON-encoded fragment that spans multiple key/value pairs (raw {}/[] leak)", () => {
    // Real shape seen on a React-Server-Components push-stream payload: the
    // inner quotes are escaped (\"), so a naive "quote ... quote" scan spans
    // straight through several real string literals into structural JSON.
    const html =
      '<script>var x="[[\\"data\\",{\\"title\\":\\"精選優惠\\"},{\\"id\\":-1,\\"name\\":\\"查看所有商店\\"}]]"</script>';
    const lines = extractEmbeddedPromoLines(html);
    expect(lines.every((l) => !/[{}[\]]/.test(l))).toBe(true);
  });

  it("caps output at 60 lines even with many distinct genuine promo strings", () => {
    const many = Array.from({ length: 100 }, (_, i) => `"促銷 ${i}: 低至${i}折"`).join(",");
    const html = `<script>var x=[${many}];</script>`;
    const lines = extractEmbeddedPromoLines(html);
    expect(lines.length).toBeLessThanOrEqual(60);
  });
});

describe("formatEmbeddedPromoBlock", () => {
  it("returns '' for an empty line list", () => {
    expect(formatEmbeddedPromoBlock([])).toBe("");
  });

  it("formats lines under the expected heading, one bullet per line", () => {
    const block = formatEmbeddedPromoBlock(["低至3折", "滿$500減$100"]);
    expect(block).toContain(EMBEDDED_PROMO_HEADING);
    expect(block).toContain("- 低至3折");
    expect(block).toContain("- 滿$500減$100");
  });
});
