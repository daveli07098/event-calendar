"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { CalendarDays, Home, Settings, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";

// Height of the bar; the layout wrapper subtracts it from h-screen/min-h-screen pages.
export const APP_NAV_HEIGHT = "2.75rem";

const LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/tickets", label: "Event Section", icon: Ticket },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const HIDDEN_PREFIXES = ["/login", "/register", "/join"];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname() ?? "/";
  const { status } = useSession();

  if (status !== "authenticated") return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <nav
      aria-label="Main"
      style={{ height: APP_NAV_HEIGHT }}
      className="sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 sm:px-4"
    >
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            title={label}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {/* Icon-only below sm so all four links plus the theme switcher fit a 390px phone. */}
            <span className="max-sm:sr-only">{label}</span>
          </Link>
        );
      })}
      <ThemeSwitcher className="ml-auto h-8 shrink-0" />
    </nav>
  );
}
