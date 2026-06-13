"use client";

// This hook's job is to mirror an external store (localStorage) into React
// state and subscribe to its change events — the documented exception to the
// "no setState in effect" guidance, so the rule is disabled file-wide here.
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import {
  BANNER_CHANGE_EVENT,
  BANNER_STORAGE_KEY,
  DEFAULT_BANNER,
  dismissBanner as dismissBannerStore,
  isBannerDismissed,
  readBannerConfig,
  writeBannerConfig,
  type BannerConfig,
} from "@/lib/banner";

/**
 * Reads + writes the site banner config, staying in sync with other components
 * (e.g. the settings editor) in the same tab via a custom event, and with other
 * tabs via the native `storage` event.
 */
export function useBannerConfig() {
  // SSR-safe initial value; the real localStorage value loads after mount.
  const [config, setConfig] = useState<BannerConfig>(DEFAULT_BANNER);
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const refresh = useCallback(() => {
    const cfg = readBannerConfig();
    setConfig(cfg);
    setDismissed(isBannerDismissed(cfg));
  }, []);

  useEffect(() => {
    refresh();
    setHydrated(true);
    const onChange = () => refresh();
    window.addEventListener(BANNER_CHANGE_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === BANNER_STORAGE_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BANNER_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  const save = useCallback((next: BannerConfig) => {
    writeBannerConfig(next);
    setConfig(next);
    setDismissed(isBannerDismissed(next));
  }, []);

  const dismiss = useCallback(() => {
    dismissBannerStore(config);
    setDismissed(true);
  }, [config]);

  return { config, dismissed, hydrated, save, dismiss };
}
