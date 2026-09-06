import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Roboto, Poppins, Lato } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { buildThemeBootScript } from "@/lib/theme-boot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  // `template` gives every child route a consistent "<Page> · Event Calendar"
  // browser-tab title; routes without their own title fall back to `default`.
  title: {
    default: "Event Calendar",
    template: "%s · Event Calendar",
  },
  description: "A Google Calendar-like web app with multiple calendar support",
  // Enables iOS "Add to Home Screen" to launch full-screen with our title.
  appleWebApp: {
    capable: true,
    title: "Calendar",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${roboto.variable} ${poppins.variable} ${lato.variable} h-full antialiased`}
    >
      <head>
        {/*
          Eliminates the light→dark (and default-accent→real-accent) flash of
          unstyled content: without this, every page loads with the server-rendered
          default theme painted first, then flips to the user's real theme once
          React hydrates and ThemeContext's effect runs.

          This is a plain inline <script> rendered directly inside <head> (not
          next/script's `strategy="beforeInteractive"` — that queues the content
          via a `self.__next_s.push(...)` call executed at Next's client bootstrap
          rather than emitting a real parser-blocking <head> script, and having
          next/script's returned <script> node sit under <html> before <body>
          also trips React 19's "Cannot render a sync or defer <script> outside
          the main document" hydration warning). A plain <script> element is
          rendered by React exactly where it appears in the tree, so placing it
          in this explicit <head> guarantees it lands in server-rendered <head>
          markup, ahead of <body>.

          A synchronous, non-async/defer <script> in <head> blocks HTML parsing —
          and therefore first paint of <body> — until it finishes running. Since it
          runs before hydration too, whatever it sets on <html> (the "dark" class,
          the --primary/--radius/etc custom properties) is exactly what
          ThemeContext's post-mount effect would otherwise have set, just applied
          before the browser paints instead of after. `suppressHydrationWarning`
          above tells React not to complain that the attributes it set (class,
          style, data-*) differ from the server-rendered markup.

          `buildThemeBootScript()` (src/lib/theme-boot.ts) stringifies the very
          same `applyThemeToDocument` function ThemeContext calls at runtime, so
          the two can't silently drift apart.
        */}
        <script id="theme-boot" dangerouslySetInnerHTML={{ __html: buildThemeBootScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          {children}
          <InstallPrompt />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
