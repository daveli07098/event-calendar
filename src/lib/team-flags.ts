/**
 * Team → flag emoji map for the World Cup theme. Keys are the Traditional
 * Chinese team names used in the imported event titles (same keys as
 * src/lib/team-kits.ts). Used to dress up match cells, the banner's live strip,
 * and the mascot's pennant.
 *
 * Unknown names (including knockout placeholders like "C組冠軍" or "M73勝者")
 * return "" so callers can render nothing rather than a wrong/neutral flag.
 */

const TEAM_FLAGS: Record<string, string> = {
  阿根廷: "🇦🇷",
  巴西: "🇧🇷",
  法國: "🇫🇷",
  德國: "🇩🇪",
  西班牙: "🇪🇸",
  英格蘭: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  蘇格蘭: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  威爾斯: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  葡萄牙: "🇵🇹",
  葡萄牙隊: "🇵🇹",
  荷蘭: "🇳🇱",
  比利時: "🇧🇪",
  克羅地亞: "🇭🇷",
  烏拉圭: "🇺🇾",
  墨西哥: "🇲🇽",
  美國: "🇺🇸",
  加拿大: "🇨🇦",
  日本: "🇯🇵",
  韓國: "🇰🇷",
  南韓: "🇰🇷",
  韓國隊: "🇰🇷",
  摩洛哥: "🇲🇦",
  塞內加爾: "🇸🇳",
  南非: "🇿🇦",
  瑞士: "🇨🇭",
  哥倫比亞: "🇨🇴",
  捷克: "🇨🇿",
  波赫: "🇧🇦",
  巴拉圭: "🇵🇾",
  卡達: "🇶🇦",
  卡塔爾: "🇶🇦",
  庫拉索: "🇨🇼",
  佛得角: "🇨🇻",
  瑞典: "🇸🇪",
  沙特: "🇸🇦",
  沙烏地阿拉伯: "🇸🇦",
  奧地利: "🇦🇹",
  烏茲別克: "🇺🇿",
  厄瓜多: "🇪🇨",
  厄瓜多爾: "🇪🇨",
  科特迪瓦: "🇨🇮",
  加納: "🇬🇭",
  伊拉克: "🇮🇶",
  澳洲: "🇦🇺",
  澳大利亞: "🇦🇺",
  意大利: "🇮🇹",
  波蘭: "🇵🇱",
  丹麥: "🇩🇰",
  挪威: "🇳🇴",
  塞爾維亞: "🇷🇸",
  突尼斯: "🇹🇳",
  喀麥隆: "🇨🇲",
  尼日利亞: "🇳🇬",
  奈及利亞: "🇳🇬",
  埃及: "🇪🇬",
  阿爾及利亞: "🇩🇿",
  伊朗: "🇮🇷",
  哥斯達黎加: "🇨🇷",
  巴拿馬: "🇵🇦",
  智利: "🇨🇱",
  秘魯: "🇵🇪",
  紐西蘭: "🇳🇿",
  新西蘭: "🇳🇿",
  約旦: "🇯🇴",
  阿聯酋: "🇦🇪",
  烏克蘭: "🇺🇦",
  土耳其: "🇹🇷",
  希臘: "🇬🇷",
};

/** Flag emoji for a team name, or "" when unknown (callers render nothing). */
export function getTeamFlag(team: string | null | undefined): string {
  if (!team) return "";
  return TEAM_FLAGS[team.trim()] ?? "";
}
