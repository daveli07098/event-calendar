"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { BANNER_PRESETS, DEFAULT_BANNER_PRESET } from "@/lib/banner";
import { useBannerConfig } from "@/lib/use-banner-config";
import { WorldCupBannerExtras } from "@/components/banner/WorldCupBannerExtras";
import { cn } from "@/lib/utils";

/**
 * Dismissible announcement banner shown at the top of the calendar. Renders a
 * background image (with a gradient fallback/tint), title, subtitle, optional
 * CTA, and a close button. Hidden until hydrated to avoid an SSR flash.
 */
export function SiteBanner() {
  const { config, dismissed, hydrated, dismiss } = useBannerConfig();
  const [imageFailed, setImageFailed] = useState(false);

  if (!hydrated || !config.enabled || dismissed) return null;

  const preset = BANNER_PRESETS[config.preset] ?? BANNER_PRESETS[DEFAULT_BANNER_PRESET];
  const gradient = preset.gradient;
  const showImage = config.imageUrl && !imageFailed;
  const isWorldCup = config.preset === "worldcup";

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border-b border-border bg-gradient-to-r text-white",
        gradient,
      )}
    >
      {/* Background image (optional) + dark scrim for text legibility */}
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={config.imageUrl}
          alt=""
          aria-hidden="true"
          onError={() => setImageFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />

      {/* World Cup only: slow-drifting pitch stripes over the scrim */}
      {isWorldCup && <div className="ec-banner-pitch" aria-hidden="true" />}

      {/* Content */}
      <div className="relative flex items-center gap-4 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold md:text-base">{config.title}</p>
          {config.subtitle && (
            <p className="truncate text-xs text-white/85 md:text-sm">{config.subtitle}</p>
          )}
          {isWorldCup && <WorldCupBannerExtras />}
        </div>

        {config.ctaLabel && config.ctaHref && (
          <Link
            href={config.ctaHref}
            className="hidden shrink-0 rounded-md bg-white/95 px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-white sm:inline-block"
          >
            {config.ctaLabel}
          </Link>
        )}

        <button
          onClick={dismiss}
          aria-label="Dismiss banner"
          title="Dismiss"
          className="shrink-0 rounded-md p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
