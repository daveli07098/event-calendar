/**
 * Plain-text handling for pasted page content in the Discount Sale scanner
 * (see src/app/api/discounts/scan/route.ts — the `pageContent` request
 * field). Some sites (hk.puma.com) are client-rendered, so a server-side
 * fetch sees almost nothing; the user's own browser is the only thing that
 * reliably sees the rendered page, so the route also accepts text the user
 * copy-pastes out of it directly (no HTML at all, just the visible text).
 *
 * NOTE: this module is a small, deliberate duplicate of the keyword-priority
 * truncation step inside extractTextFromHtml (src/lib/ai/html.ts), NOT an
 * import from it — the pasted-content feature's allowed file scope doesn't
 * include src/lib/ai/html.ts, and the algorithm is short enough that
 * duplicating it here is cheaper than the cross-scope change. If that scope
 * ever opens up, this should become a shared export instead.
 */

/**
 * Reorders `text` so sentences matching `priorityKeywords` come first (so
 * they survive truncation), then truncates to `maxLen`. Same algorithm as
 * the priority step inside extractTextFromHtml — used there on tag-stripped
 * HTML, used here directly on a plain-text paste (no tags to strip).
 */
export function prioritizeAndTruncate(text: string, priorityKeywords: RegExp, maxLen: number): string {
  const sentences = text.split(/(?<=[.!?。！？\n])\s*/);
  const relevant = sentences.filter((s) => priorityKeywords.test(s));
  const rest = sentences.filter((s) => !priorityKeywords.test(s));
  // Put relevant sentences first, then the rest — keeps total within limit
  const reordered = [...relevant, ...rest].join(" ").replace(/\s{2,}/g, " ").trim();
  return reordered.slice(0, maxLen);
}

/**
 * True when `sample` looks like it contains HTML markup (an open or close
 * tag) rather than plain visible text copied from a rendered page. Checked
 * on a bounded sample so a huge paste doesn't cost an O(n) regex scan.
 *
 * Deliberately simple: requires a letter immediately after "<" (optionally
 * "</") AND a later ">" to close it — so a stray "<" (e.g. "price < $50")
 * or ">" arrow (e.g. "10% -> 20%") alone, common in plain-text pastes with
 * numbers, does NOT get misclassified as HTML.
 */
export function looksLikeHtml(content: string, sampleSize = 4000): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content.slice(0, sampleSize));
}
