"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

/**
 * Toasts follow the app theme (sonner's own "system" would ignore the in-app
 * Light/Dark switch) and sit bottom-centre, lifted above the calendar's floating + button
 * (fixed bottom-6, 3.5rem tall) so they never cover the top search bar.
 */
function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme.mode}
      position="bottom-center"
      offset="6rem"
      mobileOffset="6rem"
      toastOptions={{ duration: 2500 }}
    />
  );
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
