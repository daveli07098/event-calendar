/**
 * Site banner — a dismissible promotional strip shown at the top of the
 * calendar for everyone, used to announce a live event (currently the World Cup).
 *
 * Config is stored in localStorage so it's easy to customize now; the shape is
 * intentionally self-contained so it can move to a server-backed/global config
 * later without touching the UI. Presets make new announcements one-liners.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW TO ADD A NEW BANNER (e.g. a sale or another tournament):
 *  1. Add an entry to BANNER_PRESETS below with a unique id and version.
 *  2. (Optional) link it to an event theme via the theme's `bannerPreset`.
 *  3. Set DEFAULT_BANNER_PRESET if it should be the one shown by default.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface BannerConfig {
  enabled: boolean;
  /** Preset id this config derived from, or "custom" when hand-edited. */
  preset: string;
  title: string;
  subtitle: string;
  /** Background image URL. Empty string → gradient-only banner. */
  imageUrl: string;
  /** Optional call-to-action. Both must be set for the button to render. */
  ctaLabel: string;
  ctaHref: string;
  /**
   * Bump when content changes so a previously-dismissed banner re-appears.
   * Dismissal is tracked per `${preset}@${version}`.
   */
  version: number;
}

export interface BannerPreset extends Omit<BannerConfig, "enabled" | "preset"> {
  id: string;
  label: string;
  /** Tailwind gradient classes used as the image fallback / overlay tint. */
  gradient: string;
}

export const BANNER_PRESETS: Record<string, BannerPreset> = {
  worldcup: {
    id: "worldcup",
    label: "⚽ World Cup",
    title: "It's World Cup season! ⚽",
    subtitle: "Follow every match — group stage to the final — right here on your calendar.",
    // Royalty-free Unsplash stadium shot; SiteBanner falls back to the gradient
    // if it fails to load, so the banner always looks intentional.
    imageUrl:
      "https://images.unsplash.com/photo-1459865264687-595d652de67e?auto=format&fit=crop&w=1600&q=70",
    ctaLabel: "View matches",
    ctaHref: "/tickets?section=worldcup",
    gradient: "from-green-600 via-emerald-600 to-green-800",
    version: 2,
  },
};

export const DEFAULT_BANNER_PRESET = "worldcup";

export const BANNER_STORAGE_KEY = "ec-banner";
/** Fired on the window when banner config changes so open tabs sync live. */
export const BANNER_CHANGE_EVENT = "ec-banner-change";
/** localStorage key holding the dismissed banner signature `${preset}@${version}`. */
export const BANNER_DISMISSED_KEY = "ec-banner-dismissed";

/** Build a full BannerConfig from a preset id. */
export function bannerConfigFromPreset(presetId: string): BannerConfig {
  const preset = BANNER_PRESETS[presetId] ?? BANNER_PRESETS[DEFAULT_BANNER_PRESET];
  return {
    enabled: true,
    preset: preset.id,
    title: preset.title,
    subtitle: preset.subtitle,
    imageUrl: preset.imageUrl,
    ctaLabel: preset.ctaLabel,
    ctaHref: preset.ctaHref,
    version: preset.version,
  };
}

export const DEFAULT_BANNER: BannerConfig = bannerConfigFromPreset(DEFAULT_BANNER_PRESET);

/** Stable signature used to remember a dismissal across reloads. */
export function bannerSignature(cfg: Pick<BannerConfig, "preset" | "version">): string {
  return `${cfg.preset}@${cfg.version}`;
}

export function readBannerConfig(): BannerConfig {
  if (typeof window === "undefined") return DEFAULT_BANNER;
  try {
    const raw = localStorage.getItem(BANNER_STORAGE_KEY);
    if (!raw) return DEFAULT_BANNER;
    return { ...DEFAULT_BANNER, ...(JSON.parse(raw) as Partial<BannerConfig>) };
  } catch {
    return DEFAULT_BANNER;
  }
}

export function writeBannerConfig(cfg: BannerConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BANNER_STORAGE_KEY, JSON.stringify(cfg));
    window.dispatchEvent(new CustomEvent(BANNER_CHANGE_EVENT));
  } catch {
    // Storage unavailable — config lasts for the session via in-memory state only
  }
}

export function isBannerDismissed(cfg: Pick<BannerConfig, "preset" | "version">): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY) === bannerSignature(cfg);
  } catch {
    return false;
  }
}

export function dismissBanner(cfg: Pick<BannerConfig, "preset" | "version">): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BANNER_DISMISSED_KEY, bannerSignature(cfg));
    window.dispatchEvent(new CustomEvent(BANNER_CHANGE_EVENT));
  } catch {
    // Best-effort — dismissal simply won't persist if storage is blocked
  }
}
