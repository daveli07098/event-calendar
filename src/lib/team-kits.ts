/**
 * Football kit colours per team, used to dress the World Cup mascot in the
 * shirt of the team the user supports. Team names match the (Traditional
 * Chinese) names used in the imported World Cup event titles.
 *
 * Curated colours cover the well-known sides; any team not listed gets a stable
 * colour derived from its name so every pick still produces a distinct kit.
 */
export interface TeamKit {
  jersey: string; // shirt
  shorts: string;
  trim: string; // number / accent
}

const DEFAULT_KIT: TeamKit = { jersey: "#dc2626", shorts: "#f1f5f9", trim: "#ffffff" };

// Hand-picked kits keyed by the Chinese team name seen in event titles.
const TEAM_KITS: Record<string, TeamKit> = {
  阿根廷: { jersey: "#6c9bd2", shorts: "#1f3a93", trim: "#ffffff" }, // sky blue
  巴西: { jersey: "#fbdf00", shorts: "#1e3a8a", trim: "#16a34a" }, // canary yellow
  法國: { jersey: "#1e3a8a", shorts: "#ffffff", trim: "#dc2626" },
  德國: { jersey: "#ffffff", shorts: "#111827", trim: "#111827" },
  西班牙: { jersey: "#c8102e", shorts: "#1e3a8a", trim: "#fcd116" },
  英格蘭: { jersey: "#ffffff", shorts: "#1e3a8a", trim: "#dc2626" },
  葡萄牙: { jersey: "#b91c1c", shorts: "#15803d", trim: "#fcd116" },
  荷蘭: { jersey: "#f97316", shorts: "#111827", trim: "#ffffff" }, // oranje
  比利時: { jersey: "#9a1f24", shorts: "#111827", trim: "#fcd116" },
  克羅地亞: { jersey: "#dc2626", shorts: "#1e3a8a", trim: "#ffffff" }, // checkered red
  烏拉圭: { jersey: "#5aa9e6", shorts: "#111827", trim: "#ffffff" },
  墨西哥: { jersey: "#15803d", shorts: "#ffffff", trim: "#dc2626" },
  美國: { jersey: "#ffffff", shorts: "#1e3a8a", trim: "#dc2626" },
  加拿大: { jersey: "#dc2626", shorts: "#ffffff", trim: "#ffffff" },
  日本: { jersey: "#1e3a8a", shorts: "#1e3a8a", trim: "#ffffff" },
  韓國: { jersey: "#dc2626", shorts: "#111827", trim: "#1e3a8a" },
  南韓: { jersey: "#dc2626", shorts: "#111827", trim: "#1e3a8a" },
  摩洛哥: { jersey: "#b91c1c", shorts: "#15803d", trim: "#ffffff" },
  塞內加爾: { jersey: "#15803d", shorts: "#ffffff", trim: "#dc2626" },
  南非: { jersey: "#15803d", shorts: "#fcd116", trim: "#ffffff" },
  瑞士: { jersey: "#dc2626", shorts: "#ffffff", trim: "#ffffff" },
  葡萄牙隊: { jersey: "#b91c1c", shorts: "#15803d", trim: "#fcd116" },
  哥倫比亞: { jersey: "#fcd116", shorts: "#1e3a8a", trim: "#dc2626" },
  韓國隊: { jersey: "#dc2626", shorts: "#111827", trim: "#1e3a8a" },
};

// A small, readable palette for deriving fallback kits deterministically.
const FALLBACK_JERSEYS = [
  "#dc2626", "#1e3a8a", "#15803d", "#f97316", "#7c3aed",
  "#0891b2", "#be185d", "#ca8a04", "#0f766e", "#9a1f24",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Kit for a team name. Falls back to a stable, name-derived colour. */
export function getTeamKit(team: string | null | undefined): TeamKit {
  if (!team) return DEFAULT_KIT;
  const exact = TEAM_KITS[team.trim()];
  if (exact) return exact;
  const h = hash(team);
  const jersey = FALLBACK_JERSEYS[h % FALLBACK_JERSEYS.length];
  // Shorts: white for dark shirts, navy for light shirts, for contrast.
  const shorts = h % 2 === 0 ? "#f1f5f9" : "#1e293b";
  return { jersey, shorts, trim: "#ffffff" };
}
