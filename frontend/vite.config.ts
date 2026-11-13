import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA = the "app" half of website+app: installable on Android/iOS home screens,
// with the Trip Capsule + map tiles cached for offline use during the trip.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Tripzy: Smarter Travel",
        short_name: "Tripzy",
        description: "Plans your trip, guards your travel, tunes your experience.",
        theme_color: "#2447d4",
        background_color: "#f6f7fb",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/trips/") && !url.pathname.endsWith("/compose"),
            handler: "NetworkFirst",
            options: { cacheName: "trip-capsules", networkTimeoutSeconds: 4 },
          },
          {
            urlPattern: /^https:\/\/[abc]?\.?tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "osm-tiles", expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
});
