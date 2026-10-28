import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { authClient } from "./lib/auth-client";
import { CONVEX_URL } from "./lib/env";
import { LangProvider } from "./lib/i18n";
import { AppStateProvider } from "./state/app";
import "./styles.css";
import { ToastProvider } from "./ui/kit";

const convex = new ConvexReactClient(CONVEX_URL);

// Ask the browser to keep this site's storage (the offline copy and the
// outbox) instead of clearing it when space runs low.
void navigator.storage?.persist?.().catch(() => false);

try {
  const theme = localStorage.getItem("acervus.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The cast covers a typing gap between better-auth 1.6.33 and the component's AuthClient type; the runtime API is the documented one. */}
    <ConvexBetterAuthProvider client={convex} authClient={authClient as never}>
      <LangProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppStateProvider>
              <App />
            </AppStateProvider>
          </BrowserRouter>
        </ToastProvider>
      </LangProvider>
    </ConvexBetterAuthProvider>
  </StrictMode>,
);
