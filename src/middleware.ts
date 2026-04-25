export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    "/settings/:path*",
    "/google/:path*",
    "/api/calendars/:path*",
    "/api/events/:path*",
    "/api/google/:path*",
  ],
};
