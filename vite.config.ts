import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    // GitHub Pages repo name:
    // https://mshahbaztariq.github.io/az-snooker-master/
    base: '/az-snooker-master/',

    server: {
      port: 3000,
      host: '0.0.0.0',
    },

    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'AZ Snooker Master',
          short_name: 'Snooker',

          // IMPORTANT for GitHub Pages sub-path:
          start_url: '/az-snooker-master/',
          scope: '/az-snooker-master/',

          display: 'standalone',
          background_color: '#0f172a',
          theme_color: '#0f172a',

          // IMPORTANT: icons must also include the sub-path
          icons: [
            {
              src: '/az-snooker-master/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/az-snooker-master/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
      }),
    ],

    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
