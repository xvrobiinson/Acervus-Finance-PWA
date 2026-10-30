import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The app asks before switching to a new version, so nothing being
      // typed is lost; queued offline changes live in IndexedDB either way.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png", "fonts/*.ttf"],
      manifest: {
        id: "/",
        name: "Acervus Finance",
        short_name: "Acervus",
        description: "Lending portfolio: clients, loans, payments, income and expenses.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#F7F8FA",
        theme_color: "#365CF5",
        categories: ["finance", "business", "productivity"],
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ttf,webmanifest}"],
        navigateFallback: "/index.html",
        // The desktop's Google sign-in page must never become the app, or
        // the app would use the sign-in token meant for the desktop.
        navigateFallbackDenylist: [/^\/desktop-sign-in/],
        // Only the app itself is cached. Financial data never goes through
        // the service worker: it comes from Convex over a WebSocket and is
        // kept by the app in IndexedDB, per signed-in user.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
});
