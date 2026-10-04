import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-180.png'],
      manifest: {
        name: 'Fair Drop',
        short_name: 'Fair Drop',
        description: 'A fair way to get a seat',
        theme_color: '#cf3f1a',
        background_color: '#f3f2ef',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The shell is precached so a reload during the reveal burst never waits on the origin.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Drop artwork, if the backend ever sends any. API calls are never cached here,
            // the server is the only source of truth for state.
            // Served from cache straight away on a
            // repeat visit and refreshed in the background.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          radix: ['@radix-ui/react-dialog', '@radix-ui/react-slot'],
        },
      },
    },
  },
  server: {
    // Local testing only: API_PROXY points at the stack, API_TEST_KEY lets the dev server ask for login codes.
    // Each browser host (localhost, 127.0.0.1, a phone on the wifi) also gets its own test client address,
    // so the participant window and the organiser window are limited separately, like two real machines.
    proxy: {
      '/api': {
        target: process.env.API_PROXY ?? 'http://localhost:3000',
        configure: (proxy) => {
          const key = process.env.API_TEST_KEY
          if (!key) return
          proxy.on('proxyReq', (proxyReq, req) => {
            const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
            let h = 0
            for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) >>> 0
            proxyReq.setHeader('X-Test-Key', key)
            proxyReq.setHeader('X-Test-Client-IP', `10.77.${(h >> 8) & 255}.${(h & 255) || 1}`)
          })
        },
      },
    },
  },
})
