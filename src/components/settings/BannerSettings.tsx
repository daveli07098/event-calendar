"use client";

import { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useBannerConfig } from "@/lib/use-banner-config";
import {
  BANNER_PRESETS,
  bannerConfigFromPreset,
  type BannerConfig,
} from "@/lib/banner";
import { cn } from "@/lib/utils";

/**
 * Editor for the site banner: toggle, preset picker, and free-text fields with
 * a live preview. Saves to the shared banner store so the calendar updates as
 * soon as the user navigates back.
 */
export function BannerSettings() {
  const { config, save } = useBannerConfig();
  // Local draft so typing doesn't thrash the store / re-show a dismissed banner.
  const [draft, setDraft] = useState<BannerConfig>(config);

  // Keep the draft in sync when the stored config changes externally.
  useEffect(() => {
    setDraft(config);
  }, [config]);

  const update = (patch: Partial<BannerConfig>) => {
    // Any manual field edit marks the config as "custom" so it isn't silently
    // overwritten by preset defaults on reload.
    const next = { ...draft, ...patch };
    if (
      patch.title !== undefined ||
      patch.subtitle !== undefined ||
      patch.imageUrl !== undefined ||
      patch.ctaLabel !== undefined ||
      patch.ctaHref !== undefined
    ) {
      next.preset = "custom";
    }
    setDraft(next);
    save(next);
  };

  const applyPreset = (presetId: string) => {
    const next = { ...bannerConfigFromPreset(presetId), enabled: draft.enabled };
    setDraft(next);
    save(next);
  };

  const preset = BANNER_PRESETS[draft.preset];
  const gradient = preset?.gradient ?? "from-slate-600 to-slate-800";

  return (
    <div className="space-y-5">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Show banner</p>
          <p className="text-xs text-muted-foreground">
            A dismissible announcement strip at the top of the calendar.
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(checked) => update({ enabled: checked })}
        />
      </div>

      {/* Preset picker */}
      <div>
        <p className="text-sm font-medium mb-2">Preset</p>
        <div className="flex flex-wrap gap-2">
          {Object.values(BANNER_PRESETS).map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={cn(
                "px-3 py-1.5 rounded-md border text-sm transition-colors",
                draft.preset === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          ))}
          {draft.preset === "custom" && (
            <span className="px-3 py-1.5 rounded-md border border-dashed border-border text-sm text-muted-foreground">
              Custom
            </span>
          )}
        </div>
      </div>

      {/* Live preview */}
      <div>
        <p className="text-sm font-medium mb-2">Preview</p>
        <div className={cn("relative overflow-hidden rounded-md border border-border bg-gradient-to-r text-white", gradient)}>
          {draft.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.imageUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-black/45" aria-hidden />
          <div className="relative flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{draft.title || "Banner title"}</p>
              {draft.subtitle && <p className="truncate text-xs text-white/85">{draft.subtitle}</p>}
            </div>
            {draft.ctaLabel && draft.ctaHref && (
              <span className="shrink-0 rounded-md bg-white/95 px-3 py-1.5 text-xs font-medium text-black">
                {draft.ctaLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="banner-title">Title</Label>
          <Input
            id="banner-title"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="It's World Cup season! ⚽"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="banner-subtitle">Subtitle</Label>
          <Input
            id="banner-subtitle"
            value={draft.subtitle}
            onChange={(e) => update({ subtitle: e.target.value })}
            placeholder="Follow every match right here."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="banner-image">Background image URL</Label>
          <Input
            id="banner-image"
            value={draft.imageUrl}
            onChange={(e) => update({ imageUrl: e.target.value })}
            placeholder="https://…  (leave blank for gradient only)"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="banner-cta-label">Button label</Label>
            <Input
              id="banner-cta-label"
              value={draft.ctaLabel}
              onChange={(e) => update({ ctaLabel: e.target.value })}
              placeholder="View matches"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="banner-cta-href">Button link</Label>
            <Input
              id="banner-cta-href"
              value={draft.ctaHref}
              onChange={(e) => update({ ctaHref: e.target.value })}
              placeholder="/?category=sports"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">
          Changes save automatically and apply on the calendar.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => applyPreset(preset?.id ?? "worldcup")}
          disabled={draft.preset !== "custom"}
        >
          <RotateCcw className="size-3.5" />
          Reset to preset
        </Button>
      </div>
    </div>
  );
}
