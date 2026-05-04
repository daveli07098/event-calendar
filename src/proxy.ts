import { auth } from "@/lib/auth";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return auth(request as unknown as Parameters<typeof auth>[0]);
}

export const config = {
  matcher: [
    "/settings/:path*",
    "/google/:path*",
    "/api/calendars/:path*",
    "/api/events/:path*",
    "/api/google/:path*",
  ],
};
