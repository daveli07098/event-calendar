import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Roboto, Poppins, Lato } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
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
