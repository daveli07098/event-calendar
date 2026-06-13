"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { isWorldCupEvent, buildGroups } from "@/lib/worldcup";
import { getTeamKit } from "@/lib/team-kits";
import type { EventType } from "@/types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const TOURNAMENT_START = "2026-06-01T00:00:00.000Z";
const TOURNAMENT_END = "2026-07-31T23:59:59.000Z";

/** Fetch the distinct group-stage team names from the user's World Cup events. */
export function useWorldCupTeams(enabled: boolean): { teams: string[] } {
  const [teams, setTeams] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled || teams.length > 0) return;
    let cancelled = false;
    fetch(`/api/events?start=${TOURNAMENT_START}&end=${TOURNAMENT_END}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((json: unknown) => {
        if (cancelled) return;
        const events = Array.isArray(json) ? (json as EventType[]).filter(isWorldCupEvent) : [];
        const names = new Set<string>();
        for (const g of buildGroups(events)) for (const t of g.teams) names.add(t);
        setTeams([...names].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {/* leave empty — picker just won't offer options */});
    return () => { cancelled = true; };
  }, [enabled, teams.length]);
  return { teams };
}

/** A small coloured dot showing a team's kit colour. */
function KitDot({ team }: { team: string }) {
  const kit = getTeamKit(team);
  return (
    <span
      className="inline-block size-3 rounded-full border border-border"
      style={{ background: `linear-gradient(135deg, ${kit.jersey} 60%, ${kit.shorts} 60%)` }}
    />
  );
}

/** Reusable team dropdown — used in the prompt dialog and in Settings. */
export function TeamSelect({
  value, onChange, teams, placeholder = "Choose a team…",
}: {
  value: string | null | undefined;
  onChange: (team: string) => void;
  teams: string[];
  placeholder?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(String(v))}>
      <SelectTrigger className="w-full" size="default">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {teams.map((t) => (
          <SelectItem key={t} value={t}>
            <KitDot team={t} />
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Auto-prompts the user to pick the team they support the first time the
 * Football theme is active and no team has been chosen yet. Mounted globally so
 * it can pop over any page. Choosing (or skipping) records the answer so it
 * never nags again — the team is changeable later in Settings → Appearance.
 */
export function TeamPicker() {
  const { theme, setTheme } = useTheme();
  const isWorldCup = theme.eventTheme === "worldcup";
  const { teams } = useWorldCupTeams(isWorldCup);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>("");
  const asked = useRef(false);
  const committed = useRef(false); // true once the user saved/declined explicitly

  // Prompt once: World Cup theme active, never answered, and we have teams to
  // offer. Delay briefly so the server-synced setting can arrive first.
  useEffect(() => {
    if (asked.current) return;
    if (!isWorldCup || theme.favouriteTeam !== undefined || teams.length === 0) return;
    const t = setTimeout(() => {
      if (theme.favouriteTeam === undefined) {
        asked.current = true;
        setOpen(true);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [isWorldCup, theme.favouriteTeam, teams.length]);

  function save() {
    committed.current = true;
    if (choice) setTheme({ favouriteTeam: choice });
    setOpen(false);
  }
  function skip() {
    committed.current = true;
    setTheme({ favouriteTeam: null }); // declined — don't ask again
    setOpen(false);
  }

  // Closing via backdrop/Esc counts as declining — but never clobber a pick
  // that save() already committed.
  function handleOpenChange(o: boolean) {
    if (o) { setOpen(true); return; }
    if (!committed.current) setTheme({ favouriteTeam: null });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>⚽ Who do you support?</DialogTitle>
          <DialogDescription>
            Pick your team and the calendar mascot will wear its kit. You can change this
            anytime in Settings → Appearance.
          </DialogDescription>
        </DialogHeader>
        <TeamSelect value={choice} onChange={setChoice} teams={teams} />
        <DialogFooter>
          <Button variant="ghost" onClick={skip}>Not now</Button>
          <Button onClick={save} disabled={!choice}>Support this team</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
