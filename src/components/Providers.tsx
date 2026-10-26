"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

/**
 * Toasts follow the app theme (sonner's own "system" would ignore the in-app
 * Light/Dark switch) and sit top-centre, below the nav, so they never cover the
 * calendar's floating + button at the bottom-right.
 */
function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme.mode} position="top-center" offset="3.5rem" mobileOffset="3.5rem" />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        {children}
        <ThemedToaster />
      </ThemeProvider>
    </SessionProvider>
  );
}
