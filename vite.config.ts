import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  const BASE = "/az-snooker-master/";

  return {
    base: BASE,

    server: {
      port: 3000,
      host: "0.0.0.0",
    },

    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",

        // ✅ Ensure mp3 files can be precached (important for PWA/SW behavior)
        includeAssets: ["audio/*.mp3", "icons/*.png"],

        manifest: {
          name: "AZ Snooker Master",
          short_name: "Snooker",

          // ✅ GitHub Pages sub-path
          start_url: BASE,
          scope: BASE,

          display: "standalone",
          background_color: "#0f172a",
          theme_color: "#0f172a",

          // ✅ Use relative paths (safer inside manifest)
          icons: [
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },

        workbox: {
          // ✅ Make sure mp3 is actually precached in dist/sw precache list
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,mp3}"],

          // ✅ CRITICAL: do NOT SPA-fallback /audio URLs to index.html
          navigateFallbackDenylist: [
            new RegExp(`^${BASE}audio/`),
            new RegExp(`^${BASE}icons/`),
            /\/assets\//,
          ],
        },
      }),
    ],

    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
