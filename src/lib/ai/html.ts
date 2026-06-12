/**
 * HTML → plain-text extraction for AI prompts. Strips non-content blocks and
 * surfaces keyword-relevant sentences first so they survive truncation.
 */
export function extractTextFromHtml(
  html: string,
  /** Sentences matching this pattern are moved to the front before truncation. */
  priorityKeywords?: RegExp,
  maxLen = 8000
): string {
  // Remove script, style, head, nav, footer blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")           // remaining tags → space
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")            // collapse whitespace
    .trim();

  if (priorityKeywords) {
    const sentences = text.split(/(?<=[.!?。！？\n])\s*/);
    const relevant = sentences.filter((s) => priorityKeywords.test(s));
    const rest = sentences.filter((s) => !priorityKeywords.test(s));
    // Put relevant sentences first, then the rest — keeps total within limit
    text = [...relevant, ...rest].join(" ").replace(/\s{2,}/g, " ").trim();
  }

  return text.slice(0, maxLen);
}
