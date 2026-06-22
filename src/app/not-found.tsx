import Link from "next/link";
import { CalendarX2 } from "lucide-react";

/** Friendly 404 shown for unmatched routes. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
      <CalendarX2 className="size-12 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to calendar
      </Link>
    </div>
  );
}
