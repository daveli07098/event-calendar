import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the app installable to a mobile home screen / desktop.
 * SVG icons are used (modern browsers accept them for installability); the
 * maskable variant has a safe-zone padded background for Android adaptive icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Event Calendar",
    short_name: "Calendar",
    description:
      "Track concerts, sports, ticket sales and more — a Google Calendar-style web app.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#3b82f6",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
