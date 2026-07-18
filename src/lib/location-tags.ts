/**
 * Canonical location (country/region) tagging rules — single source of truth.
 *
 * Used by BOTH:
 *   • /api/events/tag-location — sidebar chip counts + rule-based location tagging
 *   • CalendarView's location filter — deciding which events a chip shows
 *
 * These two MUST agree: the counts match title+location against these regexes,
 * so if the filter instead did a naive substring match on the location field, an
 * event whose location says only 香港 (enrichLocationWithCountry deliberately
 * skips appending ", Hong Kong" next to 香港) would be counted by the chip but
 * hidden by the filter.
 */
export const LOCATION_RULES: Array<[RegExp, string]> = [
  // Hong Kong (check before China since HK is a separate region)
  [/hong kong|香港|hk\b|hksar/i, "Hong Kong"],
  // Macau
  [/macau|macao|澳門/i, "Macau"],
  // Taiwan
  [/taiwan|taipei|臺灣|台灣|台北|taichung|台中|kaohsiung|高雄/i, "Taiwan"],
  // Japan cities
  [/japan|tokyo|osaka|kyoto|nagoya|yokohama|sapporo|fukuoka|日本|東京|大阪|京都|名古屋|橫濱|札幌|福岡/i, "Japan"],
  // Korea
  [/korea|seoul|busan|韓國|首爾|釜山/i, "South Korea"],
  // Singapore
  [/singapore|新加坡/i, "Singapore"],
  // Thailand
  [/thailand|bangkok|泰國|曼谷/i, "Thailand"],
  // China (mainland — after HK/TW/MO)
  [/\bchina\b|beijing|shanghai|shenzhen|guangzhou|chengdu|中國|北京|上海|深圳|廣州|成都/i, "China"],
  // UK
  [/\buk\b|united kingdom|london|manchester|birmingham|英國|倫敦/i, "United Kingdom"],
  // USA
  [/\busa\b|\bus\b|united states|new york|los angeles|chicago|houston|美國|紐約|洛杉磯/i, "United States"],
  // Australia
  [/australia|sydney|melbourne|澳洲|澳大利亞/i, "Australia"],
  // Canada
  [/canada|toronto|vancouver|加拿大/i, "Canada"],
  // Malaysia
  [/malaysia|kuala lumpur|馬來西亞|吉隆坡/i, "Malaysia"],
  // Philippines
  [/philippines|manila|菲律賓|馬尼拉/i, "Philippines"],
  // Indonesia
  [/indonesia|jakarta|印尼|雅加達/i, "Indonesia"],
  // France
  [/france|paris|法國|巴黎/i, "France"],
  // Germany
  [/germany|berlin|德國|柏林/i, "Germany"],
];

/** Detect the canonical country tag from an event's title + location. Null if no rule matches. */
export function detectLocationTag(title: string, location: string | null): string | null {
  const haystack = `${title} ${location ?? ""}`;
  for (const [re, country] of LOCATION_RULES) {
    if (re.test(haystack)) return country;
  }
  return null;
}
